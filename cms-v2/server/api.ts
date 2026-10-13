// /api/admin/* router. Order of checks for every request:
// method/route → Access identity (signature, audience, allowlist) → CSRF →
// rate limit → input validation → role → operation → audit.
import { z } from "zod";
import { isDocumentId, type DocumentId } from "../shared/documents";
import { opsSchema } from "../shared/ops";
import { audit, listAudit } from "./audit";
import { authenticate, requireRole, type AccessConfig, type Actor } from "./auth";
import { ContentService, type Branches } from "./content";
import { errorResponse, HttpError, json, SECURITY_HEADERS } from "./errors";
import { assertSameOrigin, rateLimit, readJson, type KV } from "./guards";
import { isUploadPath, MAX_UPLOAD_BYTES, mimeFor } from "./media";
import type { RepoStore } from "./store";
import type { JWTVerifyGetKey } from "jose";

export interface ApiDeps {
  access: AccessConfig;
  store: () => RepoStore;
  kv?: KV;
  branches?: Branches;
  repo?: string;
  /** Tests inject local keys instead of fetching the Access certificates. */
  accessKeys?: JWTVerifyGetKey;
}

const editBody = z.strictObject({ mode: z.enum(["draft", "publish"]), ops: opsSchema, summary: z.string().max(120).optional() });
const publishBody = z.strictObject({ summary: z.string().max(120).optional(), keepDraftVersion: z.boolean().optional() });
const restoreBody = z.strictObject({ commit: z.string().regex(/^[0-9a-f]{40}$/), expectedSha: z.string().regex(/^[0-9a-f]{40}$/) });
const SHA = /^[0-9a-f]{40}$/;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "bad_request", "Richiesta non valida.", { errors: r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) });
  return r.data;
}

function docParam(value: string): DocumentId {
  if (!isDocumentId(value)) throw new HttpError(404, "not_found", "Documento sconosciuto.");
  return value;
}

export async function handleApi(request: Request, deps: ApiDeps): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  let actor: Actor | null = null;
  let action = `${method} /${parts.join("/")}`;
  let doc: DocumentId | undefined;

  try {
    if (!["GET", "POST"].includes(method)) throw new HttpError(405, "method", "Metodo non consentito.");
    try {
      actor = await authenticate(request, deps.access, deps.accessKeys);
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        await rateLimit(deps.kv, "denied", ip);
        if (error.status === 403) await audit(deps.kv, { action: "denied", ok: false, detail: error.code, ip });
      }
      throw error;
    }
    assertSameOrigin(request);
    await rateLimit(deps.kv, method === "GET" ? "read" : parts[0] === "media" ? "upload" : "write", actor.email);
    const svc = new ContentService(deps.store(), actor, deps.branches);
    const [section, id, sub, extra] = parts;

    if (method === "GET" && section === "session") {
      return json({ email: actor.email, name: actor.name, role: actor.role, repo: deps.repo || null, auditLog: !!deps.kv });
    }
    if (method === "GET" && section === "status") return json(await svc.status());
    if (method === "GET" && section === "audit") {
      requireRole(actor, "admin");
      return json({ entries: await listAudit(deps.kv, 150) });
    }

    if (section === "documents") {
      if (!id) {
        if (method !== "GET") throw new HttpError(405, "method", "Metodo non consentito.");
        return json(await svc.listDocuments());
      }
      doc = docParam(id);
      if (method === "GET" && !sub) return json(await svc.getDocument(doc));
      if (method === "GET" && sub === "history") return json({ history: await svc.history(doc, Math.min(Number(url.searchParams.get("limit")) || 30, 100)) });
      if (method === "GET" && sub === "versions" && extra && SHA.test(extra)) return json(await svc.version(doc, extra));
      if (method === "POST" && sub === "edit") {
        const body = parse(editBody, await readJson(request));
        action = body.mode === "draft" ? "draft" : "publish";
        const result = await svc.edit(doc, body.ops, body.mode, body.summary);
        await audit(deps.kv, { email: actor.email, name: actor.name, action, doc, ok: true, commit: "commit" in result ? result.commit : undefined, detail: `${body.ops.length} operazioni`, ip });
        return json(result);
      }
      if (method === "POST" && sub === "publish") {
        const body = parse(publishBody, await readJson(request));
        if (body.keepDraftVersion) requireRole(actor, "admin");
        action = body.keepDraftVersion ? "publish-overwrite" : "publish-draft";
        const result = await svc.publishDraft(doc, body);
        await audit(deps.kv, { email: actor.email, name: actor.name, action, doc, ok: true, commit: "commit" in result ? result.commit : undefined, ip });
        return json(result);
      }
      if (method === "POST" && sub === "discard") {
        await readJson(request);
        action = "discard";
        const result = await svc.discardDraft(doc);
        await audit(deps.kv, { email: actor.email, name: actor.name, action, doc, ok: true, ip });
        return json(result);
      }
      if (method === "POST" && sub === "restore") {
        requireRole(actor, "admin");
        const body = parse(restoreBody, await readJson(request));
        action = "restore";
        const result = await svc.restore(doc, body.commit, body.expectedSha);
        await audit(deps.kv, { email: actor.email, name: actor.name, action, doc, ok: true, commit: "commit" in result ? result.commit : undefined, detail: `da ${body.commit.slice(0, 7)}`, ip });
        return json(result);
      }
    }

    if (section === "media") {
      if (method === "GET" && !id) return json({ files: await svc.listMedia() });
      if (method === "GET" && id === "raw") {
        const path = String(url.searchParams.get("path") || "").replace(/^\//, "");
        if (!isUploadPath(path)) throw new HttpError(400, "bad_path", "Percorso non valido.");
        const bytes = await svc.readMedia(path);
        if (!bytes) throw new HttpError(404, "not_found", "Immagine non trovata.");
        return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { ...SECURITY_HEADERS, "Content-Type": mimeFor(path), "Cache-Control": "private, max-age=300" } });
      }
      if (method === "POST" && !id) {
        action = "upload";
        const len = Number(request.headers.get("Content-Length") || 0);
        if (len > MAX_UPLOAD_BYTES + 64 * 1024) throw new HttpError(413, "too_large", "File troppo grande.");
        if (!(request.headers.get("Content-Type") || "").startsWith("multipart/form-data")) throw new HttpError(415, "content_type", "Usa un modulo di caricamento.");
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file === "string") throw new HttpError(400, "no_file", "Nessun file ricevuto.");
        const blob = file as unknown as Blob & { name?: string };
        if (blob.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "too_large", "File troppo grande.");
        const result = await svc.uploadMedia(new Uint8Array(await blob.arrayBuffer()), String(blob.name || "immagine"));
        await audit(deps.kv, { email: actor.email, name: actor.name, action, ok: true, commit: result.commit, detail: result.path, ip });
        return json(result, 201);
      }
    }
    throw new HttpError(404, "not_found", "Risorsa non trovata.");
  } catch (error) {
    if (actor && error instanceof HttpError && method === "POST") {
      await audit(deps.kv, { email: actor.email, name: actor.name, action, doc, ok: false, detail: `${error.status} ${error.code}`, ip });
    }
    return errorResponse(error);
  }
}
