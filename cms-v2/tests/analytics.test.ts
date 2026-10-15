// Visitor statistics: Cloudflare GraphQL query, Italian-day bucketing,
// configuration, errors and caching. Cloudflare is replaced by a fake fetch.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { getAnalytics, lastRomeDates, parseHosts, summarize, type AnalyticsConfig } from "../server/analytics";
import { handleApi } from "../server/api";
import type { KV } from "../server/guards";
import { MemoryStore } from "../server/memoryStore";
import { extractFunction, readRepo } from "./helpers";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const SITE = "fedcba9876543210fedcba9876543210";
const NOW = new Date("2026-10-15T10:30:00Z"); // 12:30 in Italy (CEST)

class MemoryKV implements KV {
  data = new Map<string, string>();
  async get(k: string) { return this.data.get(k) ?? null; }
  async put(k: string, v: string) { this.data.set(k, v); }
  async list() { return { keys: [], list_complete: true }; }
}

function fakeCloudflare(rows: unknown[], init: { status?: number; errors?: unknown[] } = {}) {
  const calls: Array<{ url: string; headers: Headers; body: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fn = (async (url: string, req: RequestInit) => {
    calls.push({ url, headers: new Headers(req.headers), body: JSON.parse(String(req.body)) });
    const payload = init.errors ? { data: null, errors: init.errors } : { data: { viewer: { accounts: [{ rumPageloadEventsAdaptiveGroups: rows }] } }, errors: null };
    return new Response(JSON.stringify(payload), { status: init.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const row = (hour: string, count: number, visits: number, sampleInterval = 1) => ({ count, sum: { visits }, avg: { sampleInterval }, dimensions: { datetimeHour: hour } });
let configSeq = 0;
// A distinct site tag per test keeps the module-level cache from leaking between tests.
const config = (fetchFn: typeof fetch, extra: Partial<AnalyticsConfig> = {}): AnalyticsConfig => ({
  apiToken: "secret-token",
  accountId: ACCOUNT,
  siteTag: SITE.slice(0, 28) + String(1000 + configSeq++).slice(-4),
  fetch: fetchFn,
  ...extra,
});

describe("Italian calendar days", () => {
  it("returns the last 30 dates ending with today in Europe/Rome", () => {
    const dates = lastRomeDates(new Date("2026-10-14T22:30:00Z")); // already the 15th in Italy
    expect(dates).toHaveLength(30);
    expect(dates.at(-1)).toBe("2026-10-15");
    expect(dates[0]).toBe("2026-09-16");
  });
  it("buckets UTC hours into Italian days, across the end of daylight saving time", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const result = summarize(
      [
        row("2026-10-24T21:00:00Z", 5, 2), // 23:00 CEST → 24 Oct
        row("2026-10-24T22:00:00Z", 3, 1), // 00:00 CEST → 25 Oct
        row("2026-10-25T22:00:00Z", 7, 4), // 23:00 CET  → 25 Oct
        row("2026-10-25T23:00:00Z", 2, 2), // 00:00 CET  → 26 Oct (today)
        row("2026-08-01T10:00:00Z", 99, 99), // outside the window
      ],
      now,
      ["calcioa5.custrento.it"],
    );
    const byDate = Object.fromEntries(result.days.map((d) => [d.date, d]));
    expect(byDate["2026-10-24"]).toEqual({ date: "2026-10-24", visits: 2, pageViews: 5 });
    expect(byDate["2026-10-25"]).toEqual({ date: "2026-10-25", visits: 5, pageViews: 10 });
    expect(result.today).toEqual({ visits: 2, pageViews: 2 });
    expect(result.last7).toEqual({ visits: 9, pageViews: 17 });
    expect(result.last30).toEqual({ visits: 9, pageViews: 17 });
    expect(result.sampled).toBe(false);
    expect(result.days.filter((d) => !["2026-10-24", "2026-10-25", "2026-10-26"].includes(d.date)).every((d) => d.visits === 0 && d.pageViews === 0)).toBe(true);
  });
  it("flags sampled data", () => {
    expect(summarize([row("2026-10-15T08:00:00Z", 10, 10, 10)], NOW, []).sampled).toBe(true);
  });
});

describe("configuration", () => {
  it("reports what is missing instead of numbers", async () => {
    expect(await getAnalytics({}, undefined, NOW)).toEqual({ configured: false, missing: ["CF_ANALYTICS_API_TOKEN", "CF_ACCOUNT_ID", "CF_WEB_ANALYTICS_SITE_TAG"] });
    expect(await getAnalytics({ apiToken: "x", accountId: "not-an-id", siteTag: SITE }, undefined, NOW)).toEqual({ configured: false, missing: ["CF_ACCOUNT_ID"] });
  });
  it("never counts pages.dev hosts and defaults to the public domain", () => {
    expect(parseHosts(undefined)).toEqual(["calcioa5.custrento.it"]);
    expect(parseHosts("cus-trento-c5.pages.dev")).toEqual(["calcioa5.custrento.it"]);
    expect(parseHosts("https://calcioa5.custrento.it/, www.example.org")).toEqual(["calcioa5.custrento.it", "www.example.org"]);
  });
});

describe("Cloudflare query", () => {
  it("asks for human page views on the public host, excluding the CMS, with the token only in the header", async () => {
    const cf = fakeCloudflare([row("2026-10-15T08:00:00Z", 12, 4)]);
    const cfg = config(cf.fn);
    const result = await getAnalytics(cfg, undefined, NOW);
    expect(result).toMatchObject({ configured: true, today: { visits: 4, pageViews: 12 }, hosts: ["calcioa5.custrento.it"] });
    expect(cf.calls).toHaveLength(1);
    const { url, headers, body } = cf.calls[0];
    expect(url).toBe("https://api.cloudflare.com/client/v4/graphql");
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(body.query).toContain("rumPageloadEventsAdaptiveGroups");
    expect(body.variables.accountTag).toBe(ACCOUNT);
    const filters = body.variables.filter.AND;
    expect(filters).toContainEqual({ siteTag: cfg.siteTag });
    expect(filters).toContainEqual({ bot: 0 });
    expect(filters).toContainEqual({ requestHost_in: ["calcioa5.custrento.it"] });
    expect(filters).toContainEqual({ requestPath_notlike: "/admin%" });
    const range = filters.find((f: Record<string, string>) => f.datetime_geq);
    expect(range.datetime_leq).toBe("2026-10-15T10:30:00Z");
    expect(Date.parse(range.datetime_geq)).toBeLessThanOrEqual(Date.parse("2026-09-15T22:00:00Z")); // 16 Sep 00:00 in Italy
  });
  it("caches results in KV and in memory", async () => {
    const cf = fakeCloudflare([row("2026-10-15T08:00:00Z", 1, 1)]);
    const kv = new MemoryKV();
    const cfg = config(cf.fn);
    await getAnalytics(cfg, kv, NOW);
    await getAnalytics(cfg, kv, new Date(NOW.getTime() + 60_000));
    expect(cf.calls).toHaveLength(1);
    expect([...kv.data.keys()].some((k) => k.startsWith("analytics:v1:"))).toBe(true);
  });
  it("turns Cloudflare failures into readable errors without leaking details", async () => {
    await expect(getAnalytics(config(fakeCloudflare([], { status: 403 }).fn), undefined, NOW)).rejects.toMatchObject({ status: 502, code: "analytics_auth" });
    await expect(getAnalytics(config(fakeCloudflare([], { errors: [{ message: "not authorized for that account" }] }).fn), undefined, NOW)).rejects.toMatchObject({ code: "analytics_auth" });
    await expect(getAnalytics(config(fakeCloudflare([], { errors: [{ message: "internal" }] }).fn), undefined, NOW)).rejects.toMatchObject({ code: "analytics_unavailable" });
    const down = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    await expect(getAnalytics(config(down), undefined, NOW)).rejects.toMatchObject({ code: "analytics_unavailable" });
  });
});

describe("GET /api/admin/analytics", () => {
  const TEAM = "custrento.cloudflareaccess.com";
  const AUD = "aud";
  let keys: JWTVerifyGetKey;
  let privateKey: CryptoKey;
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey as CryptoKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] });
  });
  const call = async (analytics: AnalyticsConfig | undefined, jwt: boolean, email = "editor@example.org", host = "https://cus-trento-c5.pages.dev") => {
    const headers: Record<string, string> = {};
    if (jwt) headers["Cf-Access-Jwt-Assertion"] = await new SignJWT({ email }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(`https://${TEAM}`).setAudience(AUD).setIssuedAt().setExpirationTime("5m").sign(privateKey);
    const store = await MemoryStore.create({});
    const res = await handleApi(new Request(`${host}/api/admin/analytics`, { headers }), {
      access: { teamDomain: TEAM, audience: AUD, admins: "editor@example.org:editor:Redazione" },
      store: () => store,
      accessKeys: keys,
      adminHost: "cus-trento-c5.pages.dev",
      analytics,
    });
    return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  it("requires the CMS login", async () => {
    expect((await call(undefined, false)).status).toBe(401);
    expect((await call(undefined, true, "stranger@example.org")).status).toBe(403);
  });
  it("does not exist on the public domain", async () => {
    expect((await call(undefined, true, "editor@example.org", "https://calcioa5.custrento.it")).status).toBe(404);
  });
  it("answers 'not configured' without credentials, and the totals with them (editors included)", async () => {
    expect(await call(undefined, true)).toEqual({ status: 200, body: { configured: false, missing: ["CF_ANALYTICS_API_TOKEN", "CF_ACCOUNT_ID", "CF_WEB_ANALYTICS_SITE_TAG"] } });
    const ok = await call(config(fakeCloudflare([row(new Date(Date.now() - 3600_000).toISOString().slice(0, 13) + ":00:00Z", 3, 2)]).fn), true);
    expect(ok.status).toBe(200);
    expect(ok.body.configured).toBe(true);
    expect(ok.body.last30).toEqual({ visits: 2, pageViews: 3 });
    expect(JSON.stringify(ok.body)).not.toContain("secret-token");
  });
});

describe("public site beacon loader", () => {
  const app = readRepo("js/app.js");
  it("is off: no token committed", () => {
    expect(app).toMatch(/const CF_WEB_ANALYTICS_TOKEN="";/);
  });
  it("loads only with a token, consent and the public host", () => {
    const loader = extractFunction(app, "loadWebAnalytics");
    const run = (token: string, consent: boolean, hostname: string) => {
      const appended: Array<{ src: string; attrs: Record<string, string> }> = [];
      const document = {
        getElementById: () => null,
        createElement: () => {
          const el = { src: "", defer: false, id: "", attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; } };
          return el;
        },
        head: { appendChild: (el: { src: string; attrs: Record<string, string> }) => appended.push(el) },
      };
      new Function("CF_WEB_ANALYTICS_TOKEN", "CF_WEB_ANALYTICS_HOSTS", "hasThirdPartyConsent", "location", "document", `${loader}; loadWebAnalytics();`)(token, ["calcioa5.custrento.it"], () => consent, { hostname }, document);
      return appended;
    };
    expect(run("", true, "calcioa5.custrento.it")).toHaveLength(0);
    expect(run("tok", false, "calcioa5.custrento.it")).toHaveLength(0);
    expect(run("tok", true, "cus-trento-c5.pages.dev")).toHaveLength(0);
    expect(run("tok", true, "main.cus-trento-c5.pages.dev")).toHaveLength(0);
    const loaded = run("tok", true, "calcioa5.custrento.it");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(JSON.parse(loaded[0].attrs["data-cf-beacon"])).toEqual({ token: "tok", spa: true });
  });
});
