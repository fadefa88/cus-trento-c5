// In-memory Git used by the tests and by the local dev server. It never
// writes to the working tree, so trying the CMS locally cannot alter content.
import { RefConflict } from "./errors";
import { gitBlobSha, type CheckSummary, type CommitInfo, type CommitRequest, type FileEntry, type RepoStore, type TreeEntry } from "./store";

interface MemCommit { sha: string; tree: Map<string, string>; parents: string[]; message: string; date: string }

export class MemoryStore implements RepoStore {
  private blobs = new Map<string, Uint8Array>();
  private commits = new Map<string, MemCommit>();
  private refs = new Map<string, string>();
  private counter = 0;
  /** Test hook: runs before a ref update, e.g. to simulate a concurrent push. */
  beforeRefUpdate?: (branch: string) => Promise<void> | void;
  commitCount = 0;

  static async create(files: Record<string, string | Uint8Array>, branch = "main"): Promise<MemoryStore> {
    const store = new MemoryStore();
    const tree = new Map<string, string>();
    for (const [path, content] of Object.entries(files)) tree.set(path, await store.putBlob(content));
    const sha = store.nextSha();
    store.commits.set(sha, { sha, tree, parents: [], message: "initial", date: new Date().toISOString() });
    store.refs.set(branch, sha);
    return store;
  }

  private nextSha() {
    this.counter += 1;
    return this.counter.toString(16).padStart(40, "0");
  }

  private async putBlob(content: string | Uint8Array) {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const sha = await gitBlobSha(bytes);
    this.blobs.set(sha, bytes);
    return sha;
  }

  async head(branch: string) {
    return this.refs.get(branch) ?? null;
  }

  async readBytes(commit: string, path: string) {
    const sha = this.commits.get(commit)?.tree.get(path);
    return sha ? this.blobs.get(sha)! : null;
  }

  async readText(commit: string, path: string): Promise<FileEntry | null> {
    const sha = this.commits.get(commit)?.tree.get(path);
    if (!sha) return null;
    return { sha, text: new TextDecoder().decode(this.blobs.get(sha)!) };
  }

  async commit(req: CommitRequest): Promise<string> {
    const base = this.commits.get(req.baseCommit);
    if (!base) throw new Error("unknown base commit");
    const tree = new Map(base.tree);
    for (const change of req.changes) {
      if (change.content === null) tree.delete(change.path);
      else tree.set(change.path, await this.putBlob(change.content));
    }
    const sha = this.nextSha();
    this.commits.set(sha, { sha, tree, parents: req.parents, message: req.message, date: new Date().toISOString() });
    await this.beforeRefUpdate?.(req.branch);
    const current = this.refs.get(req.branch) ?? null;
    if (current !== req.expectedHead) throw new RefConflict(req.branch);
    if (current && !req.parents.includes(current)) throw new RefConflict(req.branch);
    this.refs.set(req.branch, sha);
    this.commitCount += 1;
    return sha;
  }

  /** Simulates a push by someone else (Decap, a workflow). */
  async externalWrite(branch: string, path: string, content: string) {
    const head = this.refs.get(branch)!;
    return this.commit({ branch, expectedHead: head, parents: [head], baseCommit: head, changes: [{ path, content }], message: "external" });
  }

  async history(branch: string, path: string, limit: number): Promise<CommitInfo[]> {
    const out: CommitInfo[] = [];
    let sha = this.refs.get(branch);
    while (sha && out.length < limit) {
      const c = this.commits.get(sha)!;
      const parent = c.parents[0] ? this.commits.get(c.parents[0]) : undefined;
      const touches = [...c.tree.keys(), ...(parent ? [...parent.tree.keys()] : [])].some(
        (p) => (p === path || p.startsWith(path + "/")) && c.tree.get(p) !== parent?.tree.get(p),
      );
      if (touches) out.push({ sha, message: c.message, date: c.date, author: "memory" });
      sha = c.parents[0];
    }
    return out;
  }

  async listDir(commit: string, dir: string): Promise<TreeEntry[]> {
    const c = this.commits.get(commit);
    if (!c) return [];
    const prefix = dir.replace(/\/$/, "") + "/";
    return [...c.tree.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .map(([p, sha]) => ({ path: p, name: p.slice(prefix.length), sha, size: this.blobs.get(sha)!.length }));
  }

  async checks(): Promise<CheckSummary> {
    return { state: "unknown", items: [] };
  }
}
