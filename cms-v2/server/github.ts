// GitHub access for the CMS. Credentials live only in the Pages Function
// environment (secrets). With a GitHub App, every request uses a short-lived
// installation token restricted to this repository and to the permissions
// below; a fine-grained token is accepted as an alternative.
import { importPKCS8, SignJWT } from "jose";
import { HttpError, RefConflict } from "./errors";
import type { CheckSummary, CommitInfo, CommitRequest, FileEntry, RepoStore, TreeEntry } from "./store";

export interface GitHubConfig {
  repo: string; // owner/name
  appId?: string;
  appPrivateKey?: string;
  installationId?: string;
  token?: string;
}

const API = "https://api.github.com";
const TOKEN_PERMISSIONS = { contents: "write", metadata: "read", checks: "read", statuses: "read" };

let cachedToken: { key: string; token: string; expires: number } | null = null;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}

/** GitHub issues PKCS#1 keys ("BEGIN RSA PRIVATE KEY"); WebCrypto needs PKCS#8. */
export function toPkcs8Pem(pem: string): string {
  const key = pem.replace(/\\n/g, "\n").trim();
  if (key.includes("BEGIN PRIVATE KEY")) return key;
  const match = key.match(/-----BEGIN RSA PRIVATE KEY-----([\s\S]+?)-----END RSA PRIVATE KEY-----/);
  if (!match) throw new Error("GITHUB_APP_PRIVATE_KEY is not a PEM private key");
  const pkcs1 = b64ToBytes(match[1]);
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(pkcs1.length)];
  const body = [0x02, 0x01, 0x00, ...algorithm, ...octet];
  const seq = new Uint8Array([0x30, ...derLength(body.length + pkcs1.length), ...body, ...pkcs1]);
  const lines = bytesToB64(seq).match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

async function installationToken(cfg: GitHubConfig): Promise<string> {
  const key = `${cfg.appId}:${cfg.installationId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expires > Date.now() + 120_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const signingKey = await importPKCS8(toPkcs8Pem(cfg.appPrivateKey!), "RS256");
  const jwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer(String(cfg.appId)).setIssuedAt(now - 60).setExpirationTime(now + 540).sign(signingKey);
  const res = await fetch(`${API}/app/installations/${cfg.installationId}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "User-Agent": "cus-trento-cms-v2", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ repositories: [cfg.repo.split("/")[1]], permissions: TOKEN_PERMISSIONS }),
  });
  if (!res.ok) throw new HttpError(502, "github_auth", "Autenticazione GitHub non riuscita: controlla la configurazione della GitHub App.");
  const data = (await res.json()) as { token: string; expires_at: string };
  cachedToken = { key, token: data.token, expires: Date.parse(data.expires_at) };
  return data.token;
}

export function hasGitHubCredentials(cfg: GitHubConfig): boolean {
  return !!((cfg.appId && cfg.appPrivateKey && cfg.installationId) || cfg.token);
}

export class GitHubStore implements RepoStore {
  constructor(private cfg: GitHubConfig) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) throw new HttpError(500, "config", "CMS_REPO non valido");
  }

  private async token() {
    if (this.cfg.appId && this.cfg.appPrivateKey && this.cfg.installationId) return installationToken(this.cfg);
    if (this.cfg.token) return this.cfg.token;
    // Diagnostic is safe to return after Cloudflare Access authentication:
    // identify missing binding names, never expose credential values.
    const missing = [
      !this.cfg.appId ? "G_APP_ID" : null,
      !this.cfg.installationId ? "G_APP_INSTALLATION_ID" : null,
      !this.cfg.appPrivateKey ? "G_APP_PRIVATE_KEY" : null,
    ].filter(Boolean);
    throw new HttpError(503, "config", `Credenziali GitHub non configurate per il CMS. Variabili mancanti nel runtime Cloudflare: ${missing.join(", ")}.`);
  }

  private async call<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<{ status: number; data: T }> {
    const res = await fetch(`${API}/repos/${this.cfg.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cus-trento-cms-v2",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && !okStatuses.includes(res.status)) {
      // Only the status is surfaced: GitHub bodies are not forwarded to clients.
      throw new HttpError(res.status === 404 ? 404 : 502, "github", `GitHub ha risposto ${res.status} (${method} ${path.split("?")[0]})`);
    }
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async head(branch: string) {
    const { status, data } = await this.call<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodeURIComponent(branch)}`, undefined, [404]);
    return status === 404 ? null : data.object.sha;
  }

  private async blob(sha: string): Promise<Uint8Array> {
    const { data } = await this.call<{ content: string }>("GET", `/git/blobs/${sha}`);
    return b64ToBytes(data.content);
  }

  private async contents(commit: string, path: string) {
    const { status, data } = await this.call<{ type: string; sha: string; content?: string; encoding?: string }>(
      "GET", `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`, undefined, [404],
    );
    if (status === 404 || data.type !== "file") return null;
    const bytes = data.encoding === "base64" && data.content ? b64ToBytes(data.content) : await this.blob(data.sha);
    return { sha: data.sha, bytes };
  }

  async readText(commit: string, path: string): Promise<FileEntry | null> {
    const file = await this.contents(commit, path);
    return file ? { sha: file.sha, text: new TextDecoder().decode(file.bytes) } : null;
  }

  async readBytes(commit: string, path: string) {
    return (await this.contents(commit, path))?.bytes ?? null;
  }

  async commit(req: CommitRequest): Promise<string> {
    const { data: base } = await this.call<{ tree: { sha: string } }>("GET", `/git/commits/${req.baseCommit}`);
    const tree = [];
    for (const change of req.changes) {
      if (change.content === null) {
        tree.push({ path: change.path, mode: "100644", type: "blob", sha: null });
        continue;
      }
      const payload = typeof change.content === "string" ? { content: change.content, encoding: "utf-8" } : { content: bytesToB64(change.content), encoding: "base64" };
      const { data: blob } = await this.call<{ sha: string }>("POST", "/git/blobs", payload);
      tree.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const { data: newTree } = await this.call<{ sha: string }>("POST", "/git/trees", { base_tree: base.tree.sha, tree });
    const { data: commit } = await this.call<{ sha: string }>("POST", "/git/commits", { message: req.message, tree: newTree.sha, parents: req.parents });
    if (req.expectedHead === null) {
      const { status } = await this.call("POST", "/git/refs", { ref: `refs/heads/${req.branch}`, sha: commit.sha }, [422]);
      if (status === 422) throw new RefConflict(req.branch);
    } else {
      // force:false only accepts a fast-forward: if anyone pushed since we read
      // expectedHead, the update is rejected instead of overwriting their work.
      const { status } = await this.call("PATCH", `/git/refs/heads/${encodeURIComponent(req.branch)}`, { sha: commit.sha, force: false }, [422, 409]);
      if (status === 422 || status === 409) throw new RefConflict(req.branch);
    }
    return commit.sha;
  }

  async history(branch: string, path: string, limit: number): Promise<CommitInfo[]> {
    const { data } = await this.call<Array<{ sha: string; html_url: string; commit: { message: string; author: { date: string; name: string } } }>>(
      "GET", `/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=${limit}`,
    );
    return data.map((c) => ({ sha: c.sha, message: c.commit.message, date: c.commit.author.date, author: c.commit.author.name, url: c.html_url }));
  }

  async listDir(commit: string, dir: string): Promise<TreeEntry[]> {
    const { status, data } = await this.call<Array<{ type: string; path: string; name: string; sha: string; size: number }>>(
      "GET", `/contents/${dir.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`, undefined, [404],
    );
    if (status === 404 || !Array.isArray(data)) return [];
    return data.filter((e) => e.type === "file").map(({ path, name, sha, size }) => ({ path, name, sha, size }));
  }

  async checks(commit: string): Promise<CheckSummary> {
    const items: CheckSummary["items"] = [];
    try {
      const { data: runs } = await this.call<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url: string }> }>("GET", `/commits/${commit}/check-runs?per_page=30`);
      for (const r of runs.check_runs) items.push({ name: r.name, status: r.status === "completed" ? r.conclusion || "completed" : r.status, url: r.html_url });
      const { data: st } = await this.call<{ statuses: Array<{ context: string; state: string; target_url: string }> }>("GET", `/commits/${commit}/status`);
      for (const s of st.statuses) items.push({ name: s.context, status: s.state, url: s.target_url });
    } catch {
      return { state: "unknown", items };
    }
    const bad = items.some((i) => ["failure", "error", "cancelled", "timed_out", "action_required"].includes(i.status));
    const pending = items.some((i) => ["queued", "in_progress", "pending", "waiting", "requested"].includes(i.status));
    return { state: bad ? "failure" : pending ? "pending" : items.length ? "success" : "unknown", items };
  }
}
