// Local development only (vite serve): mounts the real API handler on an
// in-memory copy of the repository's CMS files and plays the role of the
// Cloudflare Access edge by signing a JWT with a throwaway key. Nothing here is
// part of the production build, and writes never reach the working tree.
import type { Plugin } from "vite";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { handleApi } from "../server/api";
import { MemoryStore } from "../server/memoryStore";
import { DOCUMENTS, DOCUMENT_IDS } from "../shared/documents";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const TEAM = "dev.cloudflareaccess.com";
const AUD = "dev-audience";

export function devApi(): Plugin {
  let ready: Promise<(req: Request) => Promise<Response>> | null = null;
  const init = async () => {
    const files: Record<string, string | Uint8Array> = {};
    for (const doc of DOCUMENT_IDS) files[DOCUMENTS[doc].file] = readFileSync(REPO + DOCUMENTS[doc].file, "utf8").replace(/\r\n/g, "\n");
    const uploads = REPO + "img/uploads";
    if (existsSync(uploads)) for (const name of readdirSync(uploads)) files[`img/uploads/${name}`] = new Uint8Array(readFileSync(`${uploads}/${name}`));
    const store = await MemoryStore.create(files);
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "dev", alg: "RS256" }] });
    const email = process.env.CMS_DEV_EMAIL || "dev@localhost.test";
    const role = process.env.CMS_DEV_ROLE === "editor" ? "editor" : "admin";
    return async (request: Request) => {
      const jwt = await new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "dev" }).setIssuer(`https://${TEAM}`).setAudience(AUD).setIssuedAt().setExpirationTime("10m").sign(privateKey);
      const headers = new Headers(request.headers);
      headers.set("Cf-Access-Jwt-Assertion", jwt);
      const forwarded = new Request(request, { headers });
      return handleApi(forwarded, { access: { teamDomain: TEAM, audience: AUD, admins: `${email}:${role}:Sviluppo` }, store: () => store, accessKeys: keys, repo: "local/dev" });
    };
  };
  return {
    name: "cms-v2-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/admin")) return next();
        ready ??= init();
        const handler = await ready;
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const origin = `http://${req.headers.host}`;
        const request = new Request(origin + req.url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: ["GET", "HEAD"].includes(req.method || "GET") ? undefined : Buffer.concat(chunks),
          duplex: "half",
        } as RequestInit);
        const response = await handler(request);
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
      // Published site files the admin reads directly (content/data.json, images).
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (!/^\/(content|img|assets)\//.test(url)) return next();
        const file = REPO + decodeURIComponent(url.slice(1));
        if (!file.startsWith(REPO) || !existsSync(file)) return next();
        res.end(readFileSync(file));
      });
    },
  };
}
