// Audit trail. Every write is a Git commit whose message carries the actor
// name and action as trailers (permanent, but public in this repository, so no
// emails there). The optional CMS_KV binding keeps a private, detailed log
// including denied requests and failures.
import type { Actor } from "./auth";
import type { KV } from "./guards";

export interface AuditEntry {
  ts: string;
  email?: string;
  name?: string;
  action: string;
  doc?: string;
  ok: boolean;
  commit?: string;
  detail?: string;
  ip?: string;
}

const RETENTION_SECONDS = 60 * 60 * 24 * 365;

export function commitMessage(summary: string, actor: Actor, action: string, doc?: string, details: string[] = []): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const lines = [`CMS: ${clean(summary)}`, ""];
  if (details.length) lines.push(...details.slice(0, 20).map((d) => `- ${clean(d)}`), "");
  lines.push(`CMS-Actor: ${clean(actor.name)}`, `CMS-Action: ${action}`);
  if (doc) lines.push(`CMS-Document: ${doc}`);
  return lines.join("\n");
}

export function parseTrailers(message: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of message.matchAll(/^CMS-([A-Za-z]+): (.+)$/gm)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

export async function audit(kv: KV | undefined, entry: Omit<AuditEntry, "ts">) {
  const record: AuditEntry = { ts: new Date().toISOString(), ...entry };
  if (!kv) {
    console.log("cms-v2 audit", JSON.stringify({ ...record, email: record.email ? "redacted" : undefined }));
    return;
  }
  // Inverted timestamp: KV lists keys in ascending order, we want newest first.
  const key = `audit:${String(9_999_999_999_999 - Date.now()).padStart(13, "0")}:${crypto.randomUUID().slice(0, 8)}`;
  try {
    await kv.put(key, JSON.stringify(record), { expirationTtl: RETENTION_SECONDS });
  } catch {
    console.error("cms-v2 audit write failed");
  }
}

export async function listAudit(kv: KV | undefined, limit = 100): Promise<AuditEntry[] | null> {
  if (!kv) return null;
  const { keys } = await kv.list({ prefix: "audit:", limit });
  const values = await Promise.all(keys.map((k) => kv.get(k.name)));
  return values.filter(Boolean).map((v) => JSON.parse(v!) as AuditEntry);
}
