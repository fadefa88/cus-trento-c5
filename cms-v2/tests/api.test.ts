// End-to-end tests of the API handler with an in-memory Git repository seeded
// from the real CMS files, and Access tokens signed by a local key pair.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DOCUMENTS, DOCUMENT_IDS } from "../shared/documents";
import { valueHash } from "../shared/json";
import { handleApi, type ApiDeps } from "../server/api";
import { MANIFEST_PATH } from "../server/content";
import type { KV } from "../server/guards";
import { MemoryStore } from "../server/memoryStore";
import { readRepo } from "./helpers";

const TEAM = "custrento.cloudflareaccess.com";
const AUD = "test-audience-tag";
const ORIGIN = "https://calcioa5.custrento.it";
let privateKey: CryptoKey;
let keys: JWTVerifyGetKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey as CryptoKey;
  const jwk = await exportJWK(pair.publicKey);
  keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] });
  otherKey = (await generateKeyPair("RS256")).privateKey as CryptoKey;
});

async function token(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; aud?: string; iss?: string; exp?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: "admin@example.org", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt(now - 10)
    .setExpirationTime(opts.exp ?? now + 600)
    .sign(opts.key ?? privateKey);
}

class MemoryKV implements KV {
  data = new Map<string, string>();
  async get(k: string) { return this.data.get(k) ?? null; }
  async put(k: string, v: string) { this.data.set(k, v); }
  async list({ prefix, limit = 1000 }: { prefix: string; limit?: number }) {
    return { keys: [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name })), list_complete: true };
  }
}

let store: MemoryStore;
let kv: MemoryKV;
let deps: ApiDeps;

beforeEach(async () => {
  const files: Record<string, string> = {};
  for (const doc of DOCUMENT_IDS) files[DOCUMENTS[doc].file] = readRepo(DOCUMENTS[doc].file);
  store = await MemoryStore.create(files);
  kv = new MemoryKV();
  deps = {
    access: { teamDomain: TEAM, audience: AUD, admins: "admin@example.org:admin:Luca, editor@example.org:editor:Redazione" },
    store: () => store,
    kv,
    accessKeys: keys,
  };
});

async function call(method: string, path: string, body?: unknown, opts: { jwt?: string | null; headers?: Record<string, string>; raw?: BodyInit } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, "X-CMS-Request": "1", ...(opts.headers || {}) };
  const jwt = opts.jwt === undefined ? await token() : opts.jwt;
  if (jwt) headers["Cf-Access-Jwt-Assertion"] = jwt;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handleApi(new Request(`${ORIGIN}/api/admin/${path}`, { method, headers, body: opts.raw ?? (body !== undefined ? JSON.stringify(body) : undefined) }), deps);
  const data: any = res.headers.get("Content-Type")?.includes("json") ? await res.json() : null; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: data, res };
}

const mainText = async (path: string) => (await store.readText((await store.head("main"))!, path))!.text;

describe("authentication and authorization", () => {
  it("rejects requests without an Access token", async () => {
    expect((await call("GET", "session", undefined, { jwt: null })).status).toBe(401);
  });
  it("rejects tokens signed by another key, for another audience, issuer, or expired", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const jwt of [await token({}, { key: otherKey }), await token({}, { aud: "other" }), await token({}, { iss: "https://evil.cloudflareaccess.com" }), await token({}, { exp: now - 3600 }), "not.a.jwt"]) {
      expect((await call("GET", "session", undefined, { jwt })).status).toBe(401);
    }
  });
  it("rejects authenticated emails that are not in the allowlist", async () => {
    const res = await call("GET", "session", undefined, { jwt: await token({ email: "someone@example.org" }) });
    expect(res.status).toBe(403);
  });
  it("fails closed when Access is not configured", async () => {
    deps.access = { admins: deps.access.admins };
    expect((await call("GET", "session")).status).toBe(503);
  });
  it("returns the session of an allowed user", async () => {
    const res = await call("GET", "session");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: "admin@example.org", role: "admin", name: "Luca" });
    expect(res.res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("editors cannot read the audit log, restore or force-publish", async () => {
    const jwt = await token({ email: "editor@example.org" });
    expect((await call("GET", "audit", undefined, { jwt })).status).toBe(403);
    const sha = "a".repeat(40);
    expect((await call("POST", "documents/roster/restore", { commit: sha, expectedSha: sha }, { jwt })).status).toBe(403);
    expect((await call("POST", "documents/roster/publish", { keepDraftVersion: true }, { jwt })).status).toBe(403);
  });
});

describe("CSRF and input hardening", () => {
  const op = async () => {
    const roster = JSON.parse(readRepo("content/cms/roster.json")).roster;
    return { mode: "publish", ops: [{ type: "upsert", list: ["roster"], id: String(roster[0].id), base: await valueHash(roster[0]), value: { ...roster[0], faculty: "Fisica" } }] };
  };
  it("requires the custom header on writes", async () => {
    const res = await call("POST", "documents/roster/edit", await op(), { headers: { "X-CMS-Request": "0" } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("csrf");
  });
  it("rejects a foreign Origin or cross-site fetch metadata", async () => {
    expect((await call("POST", "documents/roster/edit", await op(), { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await call("POST", "documents/roster/edit", await op(), { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
  });
  it("rejects non-JSON bodies, unknown documents and malformed operations", async () => {
    expect((await call("POST", "documents/roster/edit", undefined, { raw: "x=1", headers: { "Content-Type": "application/x-www-form-urlencoded" } })).status).toBe(415);
    expect((await call("GET", "documents/passwords")).status).toBe(404);
    expect((await call("POST", "documents/roster/edit", { mode: "publish", ops: [{ type: "upsert", list: ["../../etc"], id: null, base: null, value: {} }] })).status).toBe(400);
    expect((await call("POST", "documents/roster/edit", { mode: "publish", ops: [], extra: 1 })).status).toBe(400);
  });
  it("rejects unsupported methods", async () => {
    expect((await call("DELETE", "documents/roster")).status).toBe(405);
  });
});

describe("publishing", () => {
  it("publishes an edit as one commit on main with actor trailers and no other change", async () => {
    const before = await mainText("content/cms/roster.json");
    const roster = JSON.parse(before).roster;
    const res = await call("POST", "documents/roster/edit", { mode: "publish", ops: [{ type: "upsert", list: ["roster"], id: String(roster[0].id), base: await valueHash(roster[0]), value: { ...roster[0], faculty: "Fisica" } }] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    const after = JSON.parse(await mainText("content/cms/roster.json")).roster;
    expect(after[0].faculty).toBe("Fisica");
    expect(after.slice(1)).toEqual(roster.slice(1));
    const history = (await call("GET", "documents/roster/history")).body.history;
    expect(history[0]).toMatchObject({ actor: "Luca", action: "publish" });
    expect(kv.data.size).toBeGreaterThan(0);
  });

  it("rejects invalid content with 422 and leaves main untouched", async () => {
    const before = await mainText("content/cms/roster.json");
    const res = await call("POST", "documents/roster/edit", { mode: "publish", ops: [{ type: "upsert", list: ["roster"], id: null, base: null, value: { name: "X", role: "Attaccante", team: "Prima squadra", number: 120 } }] });
    expect(res.status).toBe(422);
    expect(res.body.error.details.errors.length).toBeGreaterThan(0);
    expect(await mainText("content/cms/roster.json")).toBe(before);
  });

  it("retries when someone pushes between read and write, without losing their change", async () => {
    const roster = JSON.parse(await mainText("content/cms/roster.json")).roster;
    let pushed = false;
    store.beforeRefUpdate = async (branch) => {
      if (branch === "main" && !pushed) {
        pushed = true;
        await store.externalWrite("main", "content/data.json", "{}\n");
      }
    };
    const res = await call("POST", "documents/roster/edit", { mode: "publish", ops: [{ type: "upsert", list: ["roster"], id: String(roster[1].id), base: await valueHash(roster[1]), value: { ...roster[1], faculty: "Lettere" } }] });
    expect(res.status).toBe(200);
    expect(await mainText("content/data.json")).toBe("{}\n");
    expect(JSON.parse(await mainText("content/cms/roster.json")).roster[1].faculty).toBe("Lettere");
  });

  it("returns 409 when the same item was changed by someone else", async () => {
    const roster = JSON.parse(await mainText("content/cms/roster.json")).roster;
    const base = await valueHash(roster[0]);
    const edited = { ...roster[0], birthPlace: "Rovereto" };
    await store.externalWrite("main", "content/cms/roster.json", JSON.stringify({ roster: [{ ...roster[0], birthPlace: "Arco" }, ...roster.slice(1)] }, null, 2) + "\n");
    const res = await call("POST", "documents/roster/edit", { mode: "publish", ops: [{ type: "upsert", list: ["roster"], id: String(roster[0].id), base, value: edited }] });
    expect(res.status).toBe(409);
    expect(JSON.parse(await mainText("content/cms/roster.json")).roster[0].birthPlace).toBe("Arco");
  });
});

describe("drafts", () => {
  async function staffOp(index: number, patch: Record<string, unknown>) {
    const doc = (await call("GET", "documents/staff")).body;
    const content = doc.draft?.content ?? doc.published.content;
    const item = content.staff[index];
    return { type: "upsert", list: ["staff"], id: String(item.id), base: await valueHash(item), value: { ...item, ...patch } };
  }

  it("saving a draft never touches main", async () => {
    const before = await mainText("content/cms/staff.json");
    const mainHead = await store.head("main");
    const res = await call("POST", "documents/staff/edit", { mode: "draft", ops: [await staffOp(0, { bio: "Bozza" })] });
    expect(res.status).toBe(200);
    expect(await store.head("main")).toBe(mainHead);
    expect(await mainText("content/cms/staff.json")).toBe(before);
    const draftHead = (await store.head("cms-v2-drafts"))!;
    expect(JSON.parse((await store.readText(draftHead, "content/cms/staff.json"))!.text).staff[0].bio).toBe("Bozza");
    expect(JSON.parse((await store.readText(draftHead, MANIFEST_PATH))!.text).docs.staff.ops).toHaveLength(1);
    const doc = (await call("GET", "documents/staff")).body;
    expect(doc.draft.content.staff[0].bio).toBe("Bozza");
    const list = (await call("GET", "documents")).body.documents;
    expect(list.find((d: { doc: string }) => d.doc === "staff").draft.changes).toBe(1);
  });

  it("publishing a draft replays it on the latest main, keeping concurrent changes to other items", async () => {
    await call("POST", "documents/staff/edit", { mode: "draft", ops: [await staffOp(0, { bio: "Nuova bio" })] });
    await call("POST", "documents/staff/edit", { mode: "draft", ops: [await staffOp(0, { role: "Allenatore capo" })] });
    const current = JSON.parse(await mainText("content/cms/staff.json"));
    current.staff[2].bio = "Modifica da Decap";
    await store.externalWrite("main", "content/cms/staff.json", JSON.stringify(current, null, 2) + "\n");
    const res = await call("POST", "documents/staff/publish", {});
    expect(res.status).toBe(200);
    const staff = JSON.parse(await mainText("content/cms/staff.json")).staff;
    expect(staff[0]).toMatchObject({ bio: "Nuova bio", role: "Allenatore capo" });
    expect(staff[2].bio).toBe("Modifica da Decap");
    const draftHead = (await store.head("cms-v2-drafts"))!;
    expect(JSON.parse((await store.readText(draftHead, MANIFEST_PATH))!.text).docs.staff).toBeUndefined();
    expect((await call("GET", "documents/staff")).body.draft).toBeNull();
  });

  it("a conflicting draft is not published unless an admin keeps the draft version", async () => {
    await call("POST", "documents/staff/edit", { mode: "draft", ops: [await staffOp(1, { bio: "Dalla bozza" })] });
    const current = JSON.parse(await mainText("content/cms/staff.json"));
    current.staff[1].bio = "Da Decap";
    await store.externalWrite("main", "content/cms/staff.json", JSON.stringify(current, null, 2) + "\n");
    const res = await call("POST", "documents/staff/publish", {});
    expect(res.status).toBe(409);
    expect(JSON.parse(await mainText("content/cms/staff.json")).staff[1].bio).toBe("Da Decap");
    const forced = await call("POST", "documents/staff/publish", { keepDraftVersion: true });
    expect(forced.status).toBe(200);
    expect(JSON.parse(await mainText("content/cms/staff.json")).staff[1].bio).toBe("Dalla bozza");
  });

  it("publish mode on a document with a draft publishes the draft too", async () => {
    await call("POST", "documents/staff/edit", { mode: "draft", ops: [await staffOp(0, { bio: "Uno" })] });
    const res = await call("POST", "documents/staff/edit", { mode: "publish", ops: [await staffOp(1, { bio: "Due" })] });
    expect(res.status).toBe(200);
    const staff = JSON.parse(await mainText("content/cms/staff.json")).staff;
    expect([staff[0].bio, staff[1].bio]).toEqual(["Uno", "Due"]);
  });

  it("discarding a draft restores the published version in the drafts branch", async () => {
    await call("POST", "documents/staff/edit", { mode: "draft", ops: [await staffOp(0, { bio: "Da scartare" })] });
    expect((await call("POST", "documents/staff/discard", {})).body.status).toBe("discarded");
    const draftHead = (await store.head("cms-v2-drafts"))!;
    expect((await store.readText(draftHead, "content/cms/staff.json"))!.text).toBe(await mainText("content/cms/staff.json"));
    expect((await call("GET", "documents/staff")).body.draft).toBeNull();
  });
});

describe("versions", () => {
  it("restores a previous version as a new commit, refusing stale requests", async () => {
    const original = await mainText("content/cms/videos.json");
    const firstCommit = (await store.head("main"))!;
    const videos = JSON.parse(original).videos;
    await call("POST", "documents/videos/edit", { mode: "publish", ops: [{ type: "delete", list: ["videos"], id: String(videos[0].id), base: await valueHash(videos[0]) }] });
    const current = (await call("GET", "documents/videos")).body.published;
    expect((await call("POST", "documents/videos/restore", { commit: firstCommit, expectedSha: "b".repeat(40) })).status).toBe(409);
    const res = await call("POST", "documents/videos/restore", { commit: firstCommit, expectedSha: current.sha });
    expect(res.status).toBe(200);
    expect(await mainText("content/cms/videos.json")).toBe(original);
  });
});

describe("media", () => {
  const png = () => {
    const b = new Uint8Array(64);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 20]);
    return b;
  };
  async function upload(bytes: Uint8Array, name: string) {
    const form = new FormData();
    form.append("file", new File([bytes as Uint8Array<ArrayBuffer>], name));
    const req = new Request(`${ORIGIN}/api/admin/media`, { method: "POST", body: form, headers: { Origin: ORIGIN, "X-CMS-Request": "1", "Cf-Access-Jwt-Assertion": await token() } });
    const res = await handleApi(req, deps);
    const body: any = await res.json(); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, body };
  }
  it("accepts a real PNG and stores it under img/uploads with a safe unique name", async () => {
    const res = await upload(png(), "Logo Squadra (1).PNG");
    expect(res.status).toBe(201);
    expect(res.body.path).toMatch(/^\/img\/uploads\/logo-squadra-1-[0-9a-f]{8}\.png$/);
    expect(res.body).toMatchObject({ width: 10, height: 20 });
    expect(await store.readBytes((await store.head("main"))!, res.body.path.slice(1))).not.toBeNull();
  });
  it("rejects SVG, disguised files and empty uploads", async () => {
    expect((await upload(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "logo.png")).status).toBe(415);
    expect((await upload(new TextEncoder().encode("MZ executable pretending to be an image"), "photo.jpg")).status).toBe(415);
    expect((await upload(new Uint8Array(0), "x.png")).status).toBe(400);
  });
  it("serves only image paths inside img/uploads", async () => {
    expect((await call("GET", "media/raw?path=content/cms/roster.json")).status).toBe(400);
    expect((await call("GET", "media/raw?path=img/uploads/../../.dev.vars")).status).toBe(400);
  });
});

describe("rate limiting and audit", () => {
  it("limits writes per user", async () => {
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await call("POST", "documents/news/discard", {})).status;
    expect(last).toBe(429);
  });
  it("records denied access attempts and successful writes in the private log", async () => {
    await call("GET", "session", undefined, { jwt: await token({ email: "intruder@example.org" }) });
    await call("POST", "documents/news/discard", {});
    const entries = (await call("GET", "audit")).body.entries;
    expect(entries.some((e: { action: string }) => e.action === "denied")).toBe(true);
    expect(entries.some((e: { action: string; email: string }) => e.action === "discard" && e.email === "admin@example.org")).toBe(true);
  });
});
