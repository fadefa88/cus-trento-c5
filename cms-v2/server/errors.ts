export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** The branch moved while we were writing: the caller re-reads and retries. */
export class RefConflict extends Error {
  constructor(public branch: string) {
    super(`branch ${branch} changed during the write`);
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
  "X-Robots-Tag": "noindex, nofollow",
};

export function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message, details: error.details ?? null } }, error.status);
  }
  // Never echo internal errors: they may contain upstream responses.
  console.error("cms-v2 internal error", error instanceof Error ? error.message : "unknown");
  return json({ error: { code: "internal", message: "Errore interno. Riprova tra poco." } }, 500);
}
