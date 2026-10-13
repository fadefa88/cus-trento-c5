// Identity comes only from Cloudflare Access. The Access edge adds a signed JWT
// (Cf-Access-Jwt-Assertion) to every request it lets through; here we verify the
// signature against the team's public keys, the audience of this application,
// issuer and expiry, then map the email to a CMS role. A missing or invalid
// token is always a 401: protecting the URL in Access is necessary but the
// API never relies on it alone.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { HttpError } from "./errors";

export type Role = "admin" | "editor";
export interface Actor { email: string; name: string; role: Role }

export interface AccessConfig {
  teamDomain?: string;
  audience?: string;
  admins?: string; // "email:role:Name, ..."
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

export function parseAdmins(raw: string | undefined): Map<string, { role: Role; name: string }> {
  const map = new Map<string, { role: Role; name: string }>();
  for (const entry of String(raw || "").split(/[,;\n]/)) {
    const [email, role, ...name] = entry.trim().split(":");
    if (!email || !email.includes("@")) continue;
    const r: Role = role?.trim() === "admin" ? "admin" : "editor";
    map.set(email.trim().toLowerCase(), { role: r, name: name.join(":").trim() || email.split("@")[0] });
  }
  return map;
}

function normalizeTeamDomain(domain: string): string {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(host)) throw new HttpError(500, "config", "CF_ACCESS_TEAM_DOMAIN non valido");
  return host;
}

export async function authenticate(request: Request, cfg: AccessConfig, keys?: JWTVerifyGetKey): Promise<Actor> {
  if (!cfg.teamDomain || !cfg.audience) throw new HttpError(503, "config", "Cloudflare Access non configurato per il CMS.");
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new HttpError(401, "unauthenticated", "Accesso richiesto.");
  const host = normalizeTeamDomain(cfg.teamDomain);
  let getKey = keys;
  if (!getKey) {
    getKey = jwksCache.get(host);
    if (!getKey) {
      getKey = createRemoteJWKSet(new URL(`https://${host}/cdn-cgi/access/certs`), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
      jwksCache.set(host, getKey);
    }
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, getKey, {
      issuer: `https://${host}`,
      audience: cfg.audience,
      algorithms: ["RS256"],
      clockTolerance: 30,
    }));
  } catch {
    throw new HttpError(401, "unauthenticated", "Sessione non valida o scaduta. Ricarica la pagina per accedere di nuovo.");
  }
  // Service tokens carry no email: the CMS is for people only.
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) throw new HttpError(403, "forbidden", "Identità non riconosciuta.");
  const entry = parseAdmins(cfg.admins).get(email);
  if (!entry) throw new HttpError(403, "forbidden", "Il tuo account non è autorizzato a usare il CMS.");
  return { email, name: entry.name, role: entry.role };
}

export function requireRole(actor: Actor, role: Role) {
  if (role === "admin" && actor.role !== "admin") throw new HttpError(403, "forbidden", "Operazione riservata agli amministratori.");
}
