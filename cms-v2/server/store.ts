// Minimal Git operations the CMS needs. GitHubStore talks to the GitHub API;
// MemoryStore implements the same contract in memory for tests and local dev.

export interface FileEntry { text: string; sha: string }
export interface CommitInfo { sha: string; message: string; date: string; author: string; url?: string }
export interface Change { path: string; content: string | Uint8Array | null }
export interface TreeEntry { path: string; name: string; sha: string; size: number }
export interface CheckSummary { state: "success" | "pending" | "failure" | "unknown"; items: Array<{ name: string; status: string; url?: string }> }

export interface CommitRequest {
  branch: string;
  /** Current head we expect; null creates the branch. The write fails with RefConflict if the branch moved. */
  expectedHead: string | null;
  parents: string[];
  /** Commit whose tree the changes are applied on. */
  baseCommit: string;
  changes: Change[];
  message: string;
}

export interface RepoStore {
  head(branch: string): Promise<string | null>;
  readText(commit: string, path: string): Promise<FileEntry | null>;
  readBytes(commit: string, path: string): Promise<Uint8Array | null>;
  commit(request: CommitRequest): Promise<string>;
  history(branch: string, path: string, limit: number): Promise<CommitInfo[]>;
  listDir(commit: string, dir: string): Promise<TreeEntry[]>;
  checks(commit: string): Promise<CheckSummary>;
}

/** Git blob id, so MemoryStore and GitHub report the same sha for the same content. */
export async function gitBlobSha(content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
