// API client. Every request is same-origin, sends the CSRF header and relies on
// the Cloudflare Access cookie; the browser never holds any GitHub credential.
import type { DocumentId } from "@shared/documents";
import type { Op } from "@shared/ops";

export interface ApiIssue { path: string; message: string }
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: { errors?: ApiIssue[]; conflicts?: string[]; retryAfter?: number } | null,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-CMS-Request": "1", ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Connessione assente. Controlla la rete e riprova.", null);
  }
  const type = res.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) {
    // Access answers with its login page or a redirect when the session has expired.
    if (res.status === 401 || res.status === 403 || res.redirected || type.includes("text/html")) {
      throw new ApiError(401, "unauthenticated", "Sessione scaduta: ricarica la pagina per accedere di nuovo.", null);
    }
    throw new ApiError(res.status, "bad_response", `Risposta inattesa dal server (${res.status}).`, null);
  }
  const data = (await res.json()) as { error?: { code?: string; message?: string; details?: ApiError["details"] } };
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || "error", data?.error?.message || "Errore", data?.error?.details || null);
  return data as unknown as T;
}

export interface Session { email: string; name: string; role: "admin" | "editor"; repo: string | null; auditLog: boolean; previewUrl: string | null }
export interface DraftInfo { updatedAt: string; updatedBy: string; changes: number; stale: boolean }
export interface DocumentSummary { doc: DocumentId; label: string; file: string; sha: string | null; draft: DraftInfo | null }
export interface DocumentPayload<T = Record<string, unknown>> {
  doc: DocumentId;
  file: string;
  published: { content: T; sha: string; commit: string };
  draft: (DraftInfo & { content: T }) | null;
}
export interface SaveResult { status: "published" | "draft" | "unchanged" | "discarded" | "restored"; commit?: string; warnings?: ApiIssue[] }
export interface HistoryEntry { sha: string; date: string; url?: string; title: string; actor: string; action: string }
export interface StatusPayload {
  head: string;
  checks: { state: "success" | "pending" | "failure" | "unknown"; items: Array<{ name: string; status: string; url?: string }> };
  recent: Array<{ sha: string; date: string; title: string; actor: string; document: string | null; url?: string }>;
}
export interface AnalyticsTotals { visits: number; pageViews: number }
export type AnalyticsPayload =
  | { configured: false; missing: string[] }
  | { configured: true; timezone: string; generatedAt: string; hosts: string[]; sampled: boolean; today: AnalyticsTotals; last7: AnalyticsTotals; last30: AnalyticsTotals; days: Array<{ date: string } & AnalyticsTotals> };
export interface MediaFile { path: string; name: string; size: number }
export interface AuditEntry { ts: string; email?: string; name?: string; action: string; doc?: string; ok: boolean; commit?: string; detail?: string }

export const api = {
  session: () => request<Session>("GET", "session"),
  status: () => request<StatusPayload>("GET", "status"),
  analytics: () => request<AnalyticsPayload>("GET", "analytics"),
  documents: () => request<{ mainHead: string; documents: DocumentSummary[] }>("GET", "documents"),
  document: <T>(doc: DocumentId) => request<DocumentPayload<T>>("GET", `documents/${doc}`),
  edit: (doc: DocumentId, ops: Op[], mode: "draft" | "publish", summary?: string) =>
    request<SaveResult>("POST", `documents/${doc}/edit`, { mode, ops, ...(summary ? { summary } : {}) }),
  publish: (doc: DocumentId, keepDraftVersion = false) => request<SaveResult>("POST", `documents/${doc}/publish`, keepDraftVersion ? { keepDraftVersion } : {}),
  discard: (doc: DocumentId) => request<SaveResult>("POST", `documents/${doc}/discard`, {}),
  history: (doc: DocumentId) => request<{ history: HistoryEntry[] }>("GET", `documents/${doc}/history?limit=40`),
  version: <T>(doc: DocumentId, sha: string) => request<{ content: T; sha: string }>("GET", `documents/${doc}/versions/${sha}`),
  restore: (doc: DocumentId, commit: string, expectedSha: string) => request<SaveResult>("POST", `documents/${doc}/restore`, { commit, expectedSha }),
  media: () => request<{ files: MediaFile[] }>("GET", "media"),
  upload: (files: Array<{ blob: Blob; name: string }>) => {
    const form = new FormData();
    for (const f of files) form.append("file", f.blob, f.name);
    return request<{ files: Array<{ path: string; width: number; height: number; size: number }>; commit: string }>("POST", "media", form, true);
  },
  audit: () => request<{ entries: AuditEntry[] | null }>("GET", "audit"),
};
