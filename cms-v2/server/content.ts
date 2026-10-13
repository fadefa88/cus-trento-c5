// Drafts and publishing on top of Git.
//
// Published content is `main`, exactly as today. Drafts live on the branch
// `cms-v2-drafts`, rebuilt on every draft save as "current main + the drafted
// files + .cms-v2/drafts.json". The manifest stores, for each drafted document,
// the list of edit operations: publishing replays them on the latest `main`, so
// changes made meanwhile by Decap, workflows or other editors are kept, and
// only real overlaps on the same item become conflicts.
//
// Every ref update is a compare-and-swap (fast-forward only), so concurrent
// writers can never overwrite each other: the loser re-reads and retries.
import { DOCUMENTS, DOCUMENT_IDS, type DocumentId } from "../shared/documents";
import { serializeDocument } from "../shared/json";
import { normalizeDocument } from "../shared/normalize";
import { conflictMessage, type Op } from "../shared/ops";
import { processEdit } from "../shared/pipeline";
import type { RuleContext } from "../shared/rules";
import { validateDocument } from "../shared/schemas";
import { commitMessage, parseTrailers } from "./audit";
import type { Actor } from "./auth";
import { HttpError, RefConflict } from "./errors";
import { checkUpload, MAX_BATCH_BYTES, MAX_FILES_PER_UPLOAD } from "./media";
import { gitBlobSha, type RepoStore } from "./store";

export const MANIFEST_PATH = ".cms-v2/drafts.json";
const RETRIES = 4;

export interface DraftEntry { baseSha: string; ops: Op[]; createdAt: string; updatedAt: string; updatedBy: string }
export interface Manifest { version: 1; docs: Partial<Record<DocumentId, DraftEntry>> }
interface Snapshot { mainHead: string; draftHead: string | null; manifest: Manifest }

export interface Branches { main: string; drafts: string }

export class ContentService {
  constructor(private store: RepoStore, private actor: Actor, private branches: Branches = { main: "main", drafts: "cms-v2-drafts" }) {}

  // ---- reading -------------------------------------------------------------
  private async snapshot(): Promise<Snapshot> {
    const mainHead = await this.store.head(this.branches.main);
    if (!mainHead) throw new HttpError(500, "repo", `Branch ${this.branches.main} non trovato`);
    const draftHead = await this.store.head(this.branches.drafts);
    let manifest: Manifest = { version: 1, docs: {} };
    if (draftHead) {
      const file = await this.store.readText(draftHead, MANIFEST_PATH);
      if (file) {
        try {
          const parsed = JSON.parse(file.text) as Manifest;
          if (parsed?.version === 1 && parsed.docs) manifest = parsed;
        } catch {
          /* a broken manifest is treated as "no drafts"; the next save rewrites it */
        }
      }
    }
    return { mainHead, draftHead, manifest };
  }

  private async readDoc(commit: string, doc: DocumentId) {
    const file = await this.store.readText(commit, DOCUMENTS[doc].file);
    if (!file) throw new HttpError(404, "missing_file", `${DOCUMENTS[doc].file} non trovato`);
    return { sha: file.sha, text: file.text, content: JSON.parse(file.text) as Record<string, unknown> };
  }

  async listDocuments() {
    const s = await this.snapshot();
    const entries = await this.store.listDir(s.mainHead, "content/cms");
    const shaByPath = new Map(entries.map((e) => [e.path, e.sha]));
    return {
      mainHead: s.mainHead,
      documents: DOCUMENT_IDS.map((doc) => {
        const d = s.manifest.docs[doc];
        return {
          doc,
          label: DOCUMENTS[doc].label,
          file: DOCUMENTS[doc].file,
          sha: shaByPath.get(DOCUMENTS[doc].file) ?? null,
          draft: d ? { updatedAt: d.updatedAt, updatedBy: d.updatedBy, changes: d.ops.length, stale: d.baseSha !== shaByPath.get(DOCUMENTS[doc].file) } : null,
        };
      }),
    };
  }

  async getDocument(doc: DocumentId) {
    const s = await this.snapshot();
    const pub = await this.readDoc(s.mainHead, doc);
    const entry = s.manifest.docs[doc];
    let draft = null;
    if (entry && s.draftHead) {
      const d = await this.readDoc(s.draftHead, doc);
      if (d.text !== pub.text) {
        draft = { content: d.content, updatedAt: entry.updatedAt, updatedBy: entry.updatedBy, changes: entry.ops.length, stale: entry.baseSha !== pub.sha };
      }
    }
    return { doc, file: DOCUMENTS[doc].file, published: { content: pub.content, sha: pub.sha, commit: s.mainHead }, draft };
  }

  /** Context for cross-document rules: matches are checked against the roster they will be published with. */
  private async ruleContext(doc: DocumentId, s: Snapshot, target: "main" | "draft"): Promise<RuleContext> {
    if (doc === "roster") {
      const ref = target === "draft" && s.draftHead ? s.draftHead : s.mainHead;
      const [a, b] = await Promise.all([this.readDoc(ref, "fixtures"), this.readDoc(ref, "u21Fixtures")]);
      return { matches: [...((a.content.fixtures as Array<Record<string, unknown>>) || []), ...((b.content.u21Fixtures as Array<Record<string, unknown>>) || [])] };
    }
    if (doc !== "fixtures" && doc !== "u21Fixtures") return {};
    const useDraft = target === "draft" && s.draftHead && s.manifest.docs.roster;
    const roster = await this.readDoc(useDraft ? s.draftHead! : s.mainHead, "roster");
    return { roster: (roster.content.roster as Array<Record<string, unknown>>) || [] };
  }

  // ---- writing ---------------------------------------------------------------
  private assertClean(result: Awaited<ReturnType<typeof processEdit>>) {
    if (result.conflicts.length) {
      throw new HttpError(409, "conflict", "Qualcun altro ha modificato gli stessi contenuti. Ricarica per vedere la versione aggiornata.", {
        conflicts: result.conflicts.map(conflictMessage),
      });
    }
    if (result.errors.length) throw new HttpError(422, "invalid", "Correggi gli errori evidenziati prima di salvare.", { errors: result.errors });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (!(error instanceof RefConflict) || attempt >= RETRIES) {
          if (error instanceof RefConflict) throw new HttpError(409, "busy", "Il repository è stato aggiornato più volte di seguito. Riprova.");
          throw error;
        }
      }
    }
  }

  async edit(doc: DocumentId, ops: Op[], mode: "draft" | "publish", summary?: string) {
    if (mode === "draft") return this.saveDraft(doc, ops, summary);
    const s = await this.snapshot();
    if (s.manifest.docs[doc]) {
      // The document has pending draft changes: publishing must not skip them
      // silently, so the new operations join the draft and the whole draft is published.
      await this.saveDraft(doc, ops, summary);
      return this.publishDraft(doc, { summary });
    }
    return this.publishOps(doc, ops, summary);
  }

  private async publishOps(doc: DocumentId, ops: Op[], summary?: string) {
    return this.withRetry(async () => {
      const s = await this.snapshot();
      const pub = await this.readDoc(s.mainHead, doc);
      const result = await processEdit(doc, pub.content, ops, await this.ruleContext(doc, s, "main"));
      this.assertClean(result);
      const text = serializeDocument(result.content);
      if (text === pub.text) return { status: "unchanged" as const, warnings: result.warnings };
      const commit = await this.store.commit({
        branch: this.branches.main,
        expectedHead: s.mainHead,
        parents: [s.mainHead],
        baseCommit: s.mainHead,
        changes: [{ path: DOCUMENTS[doc].file, content: text }],
        message: commitMessage(summary || `Aggiorna ${DOCUMENTS[doc].label}`, this.actor, "publish", doc),
      });
      return { status: "published" as const, commit, sha: await gitBlobSha(text), warnings: result.warnings };
    });
  }

  private async saveDraft(doc: DocumentId, ops: Op[], summary?: string) {
    return this.withRetry(async () => {
      const s = await this.snapshot();
      const entry = s.manifest.docs[doc];
      const pub = await this.readDoc(s.mainHead, doc);
      const base = entry && s.draftHead ? await this.readDoc(s.draftHead, doc) : pub;
      const result = await processEdit(doc, base.content, ops, await this.ruleContext(doc, s, "draft"));
      this.assertClean(result);
      const now = new Date().toISOString();
      const manifest: Manifest = {
        version: 1,
        docs: { ...s.manifest.docs, [doc]: { baseSha: entry?.baseSha ?? pub.sha, ops: [...(entry?.ops ?? []), ...ops], createdAt: entry?.createdAt ?? now, updatedAt: now, updatedBy: this.actor.name } },
      };
      const commit = await this.writeDrafts(s, manifest, { [doc]: result.content }, summary || `Bozza: ${DOCUMENTS[doc].label}`, "draft", doc);
      return { status: "draft" as const, commit, warnings: result.warnings };
    });
  }

  /**
   * Rewrites the drafts branch as current main + every drafted document. Other
   * drafts are rebased by replaying their operations on the new main; if that
   * conflicts they keep their previous content until they are published.
   */
  private async writeDrafts(s: Snapshot, manifest: Manifest, overrides: Partial<Record<DocumentId, Record<string, unknown>>>, summary: string, action: string, doc?: DocumentId) {
    const changes = [];
    for (const d of Object.keys(manifest.docs) as DocumentId[]) {
      let content = overrides[d];
      if (!content) {
        const pub = await this.readDoc(s.mainHead, d);
        const replay = await processEdit(d, pub.content, manifest.docs[d]!.ops, await this.ruleContext(d, s, "draft"));
        content = !replay.conflicts.length && !replay.errors.length ? replay.content : s.draftHead ? (await this.readDoc(s.draftHead, d)).content : pub.content;
      }
      changes.push({ path: DOCUMENTS[d].file, content: serializeDocument(content) });
    }
    changes.push({ path: MANIFEST_PATH, content: JSON.stringify(manifest, null, 2) + "\n" });
    return this.store.commit({
      branch: this.branches.drafts,
      expectedHead: s.draftHead,
      parents: s.draftHead ? [s.draftHead, s.mainHead] : [s.mainHead],
      baseCommit: s.mainHead,
      changes,
      message: commitMessage(summary, this.actor, action, doc),
    });
  }

  async publishDraft(doc: DocumentId, opts: { summary?: string; keepDraftVersion?: boolean } = {}) {
    const published = await this.withRetry(async () => {
      const s = await this.snapshot();
      const entry = s.manifest.docs[doc];
      if (!entry || !s.draftHead) throw new HttpError(404, "no_draft", "Nessuna bozza da pubblicare.");
      const pub = await this.readDoc(s.mainHead, doc);
      const result = await processEdit(doc, pub.content, entry.ops, await this.ruleContext(doc, s, "main"));
      let content = result.content;
      if (result.conflicts.length && opts.keepDraftVersion) {
        // Explicit choice of an administrator: publish the draft as it is,
        // overwriting the concurrent changes listed in the conflict.
        content = normalizeDocument(doc, (await this.readDoc(s.draftHead, doc)).content);
        const issues = validateDocument(doc, content);
        if (issues.length) throw new HttpError(422, "invalid", "La bozza non è valida.", { errors: issues });
      } else this.assertClean(result);
      const text = serializeDocument(content);
      if (text === pub.text) return { status: "unchanged" as const, warnings: result.warnings };
      const commit = await this.store.commit({
        branch: this.branches.main,
        expectedHead: s.mainHead,
        parents: [s.mainHead],
        baseCommit: s.mainHead,
        changes: [{ path: DOCUMENTS[doc].file, content: text }],
        message: commitMessage(opts.summary || `Pubblica ${DOCUMENTS[doc].label}`, this.actor, opts.keepDraftVersion ? "publish-overwrite" : "publish", doc, [`${entry.ops.length} modifiche dalla bozza di ${entry.updatedBy}`]),
      });
      return { status: "published" as const, commit, sha: await gitBlobSha(text), warnings: result.warnings };
    });
    await this.dropDraft(doc, `Bozza pubblicata: ${DOCUMENTS[doc].label}`, "draft-published").catch(() => undefined);
    return published;
  }

  private async dropDraft(doc: DocumentId, summary: string, action: string) {
    return this.withRetry(async () => {
      const s = await this.snapshot();
      if (!s.manifest.docs[doc]) return null;
      const docs = { ...s.manifest.docs };
      delete docs[doc];
      return this.writeDrafts(s, { version: 1, docs }, {}, summary, action, doc);
    });
  }

  async discardDraft(doc: DocumentId) {
    const commit = await this.dropDraft(doc, `Bozza scartata: ${DOCUMENTS[doc].label}`, "discard");
    return { status: commit ? ("discarded" as const) : ("unchanged" as const) };
  }

  // ---- versions --------------------------------------------------------------
  async history(doc: DocumentId, limit = 30) {
    const commits = await this.store.history(this.branches.main, DOCUMENTS[doc].file, limit);
    return commits.map((c) => {
      const trailers = parseTrailers(c.message);
      return { sha: c.sha, date: c.date, url: c.url, title: c.message.split("\n")[0], actor: trailers.actor || c.author, action: trailers.action || (/^Update .*“/.test(c.message) ? "decap" : "git") };
    });
  }

  async version(doc: DocumentId, commit: string) {
    const file = await this.store.readText(commit, DOCUMENTS[doc].file);
    if (!file) throw new HttpError(404, "missing_version", "Versione non trovata.");
    return { content: JSON.parse(file.text), sha: file.sha };
  }

  /** Restores a previous version as a new commit; refuses if main changed since the editor looked at it. */
  async restore(doc: DocumentId, commit: string, expectedSha: string) {
    return this.withRetry(async () => {
      const s = await this.snapshot();
      const pub = await this.readDoc(s.mainHead, doc);
      if (pub.sha !== expectedSha) throw new HttpError(409, "conflict", "Il documento è cambiato nel frattempo: ricarica la cronologia e riprova.");
      const old = await this.store.readText(commit, DOCUMENTS[doc].file);
      if (!old) throw new HttpError(404, "missing_version", "Versione non trovata.");
      const content = JSON.parse(old.text);
      const issues = validateDocument(doc, content);
      if (issues.length) throw new HttpError(422, "invalid", "Questa versione non è compatibile con le regole attuali.", { errors: issues });
      if (old.text === pub.text) return { status: "unchanged" as const };
      const newCommit = await this.store.commit({
        branch: this.branches.main,
        expectedHead: s.mainHead,
        parents: [s.mainHead],
        baseCommit: s.mainHead,
        changes: [{ path: DOCUMENTS[doc].file, content: old.text }],
        message: commitMessage(`Ripristina ${DOCUMENTS[doc].label} alla versione ${commit.slice(0, 7)}`, this.actor, "restore", doc),
      });
      return { status: "restored" as const, commit: newCommit };
    });
  }

  // ---- media -----------------------------------------------------------------
  async listMedia() {
    const head = await this.store.head(this.branches.main);
    const files = await this.store.listDir(head!, "img/uploads");
    return files.filter((f) => /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(f.name)).map((f) => ({ path: "/" + f.path, name: f.name, size: f.size }));
  }

  /**
   * Images go straight to main: an unreferenced file is never touched by the
   * optimize workflow (it only processes images referenced by published JSON),
   * and it must exist on main before the content that uses it is published.
   */
  async uploadMedia(files: Array<{ bytes: Uint8Array; name: string }>) {
    if (!files.length) throw new HttpError(400, "no_file", "Nessun file ricevuto.");
    if (files.length > MAX_FILES_PER_UPLOAD) throw new HttpError(413, "too_many", `Al massimo ${MAX_FILES_PER_UPLOAD} immagini per volta.`);
    const checked = files.map((f) => checkUpload(f.bytes, f.name));
    if (checked.reduce((n, f) => n + f.bytes.length, 0) > MAX_BATCH_BYTES) throw new HttpError(413, "too_large", "Caricamento troppo grande: dividilo in più parti.");
    const names = checked.map((f) => f.path.split("/").pop()).join(", ");
    // One commit for the whole batch: a gallery upload triggers a single deployment.
    const commit = await this.withRetry(async () => {
      const head = await this.store.head(this.branches.main);
      return this.store.commit({
        branch: this.branches.main,
        expectedHead: head,
        parents: [head!],
        baseCommit: head!,
        changes: checked.map((f) => ({ path: f.path, content: f.bytes })),
        message: commitMessage(checked.length === 1 ? `Carica immagine ${names}` : `Carica ${checked.length} immagini`, this.actor, "upload", undefined, checked.length > 1 ? checked.map((f) => f.path) : []),
      });
    });
    return { files: checked.map((f) => ({ path: f.publicPath, width: f.width, height: f.height, size: f.bytes.length })), commit };
  }

  async readMedia(path: string) {
    const head = await this.store.head(this.branches.main);
    return this.store.readBytes(head!, path);
  }

  async status() {
    const head = await this.store.head(this.branches.main);
    const [checks, recent] = await Promise.all([this.store.checks(head!), this.store.history(this.branches.main, "content/cms", 15)]);
    return {
      head,
      checks,
      recent: recent.map((c) => {
        const t = parseTrailers(c.message);
        return { sha: c.sha, date: c.date, title: c.message.split("\n")[0], actor: t.actor || c.author, document: t.document || null, url: c.url };
      }),
    };
  }
}
