// Request guards: CSRF, body limits and rate limiting.
import { HttpError } from "./errors";

/**
 * Cross-site request forgery: the Access cookie is sent by the browser with
 * any request to this host, so every state-changing request must also carry a
 * custom header (impossible cross-origin without a CORS preflight, which this
 * API never grants) and, when the browser sends it, a same-origin Origin.
 */
export function assertSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (request.headers.get("X-CMS-Request") !== "1") throw new HttpError(403, "csrf", "Richiesta non valida (header mancante).");
  const origin = request.headers.get("Origin");
  const own = new URL(request.url).origin;
  if (origin && origin !== own) throw new HttpError(403, "csrf", "Origine della richiesta non consentita.");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") throw new HttpError(403, "csrf", "Origine della richiesta non consentita.");
}

export async function readJson(request: Request, maxBytes = 512 * 1024): Promise<unknown> {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "content_type", "Formato della richiesta non supportato.");
  }
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > maxBytes) throw new HttpError(413, "too_large", "Richiesta troppo grande.");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "too_large", "Richiesta troppo grande.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "bad_json", "JSON non valido.");
  }
}

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
}

export const LIMITS = {
  read: { max: 240, windowSec: 60 },
  write: { max: 30, windowSec: 60 },
  upload: { max: 30, windowSec: 600 },
  denied: { max: 20, windowSec: 300 },
} as const;
export type LimitName = keyof typeof LIMITS;

const memoryCounters = new Map<string, { count: number; reset: number }>();

/**
 * Fixed-window limiter. With the CMS_KV binding the counters are shared across
 * Cloudflare locations (eventually consistent, so a burst can exceed the limit
 * slightly); without it they are per isolate, a best-effort fallback.
 */
export async function rateLimit(kv: KV | undefined, name: LimitName, identity: string) {
  const { max, windowSec } = LIMITS[name];
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${name}:${identity}:${window}`;
  let count: number;
  if (kv) {
    count = Number((await kv.get(key)) || 0) + 1;
    await kv.put(key, String(count), { expirationTtl: Math.max(60, windowSec * 2) });
  } else {
    const now = Date.now();
    const entry = memoryCounters.get(key);
    count = entry && entry.reset > now ? entry.count + 1 : 1;
    memoryCounters.set(key, { count, reset: now + windowSec * 1000 });
    if (memoryCounters.size > 5000) for (const [k, v] of memoryCounters) if (v.reset <= now) memoryCounters.delete(k);
  }
  if (count > max) throw new HttpError(429, "rate_limited", "Troppe richieste: attendi qualche istante e riprova.", { retryAfter: windowSec });
}
