// Visitor statistics: Cloudflare GraphQL query, Italian-day bucketing,
// configuration, errors and caching. Cloudflare is replaced by a fake fetch.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { getAnalytics, lastRomeDates, romeMidnightUtc, apportion, parseHosts, summarize, type AnalyticsConfig } from "../server/analytics";
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

function fakeCloudflare(rows: unknown[], init: { status?: number; errors?: unknown[]; ungrouped?: { visits: number; pageViews: number } } = {}) {
  const calls: Array<{ url: string; headers: Headers; body: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fn = (async (url: string, req: RequestInit) => {
    const body = JSON.parse(String(req.body));
    calls.push({ url, headers: new Headers(req.headers), body });
    type FakeRow = { count: number; sum: { visits: number }; avg: { sampleInterval: number }; dimensions: { datetimeHour: string } };
    const select = (filterName: string): FakeRow[] => {
      const range = body.variables[filterName].AND.find((f: Record<string, string>) => f.datetime_geq);
      return (rows as FakeRow[]).filter((row) =>
        Date.parse(row.dimensions.datetimeHour) >= Date.parse(range.datetime_geq) &&
        Date.parse(row.dimensions.datetimeHour) <= Date.parse(range.datetime_leq));
    };
    const aggregate = (selected: FakeRow[]) => {
      if (!selected.length) return [];
      const weighted = selected.reduce((a, r) => ({
        pageViews: a.pageViews + r.count, visits: a.visits + r.sum.visits,
        interval: Math.max(a.interval, r.avg.sampleInterval),
      }), { pageViews: 0, visits: 0, interval: 1 });
      const totals = init.ungrouped || weighted;
      return [{ count: totals.pageViews, sum: { visits: totals.visits }, avg: { sampleInterval: weighted.interval } }];
    };
    const payload = init.errors ? { data: null, errors: init.errors } : {
      data: { viewer: { accounts: [{
        today: aggregate(select("todayFilter")),
        last24: aggregate(select("last24Filter")),
        last7: aggregate(select("last7Filter")),
        last30: aggregate(select("last30Filter")),
        hourly: select("last30Filter"),
      }] } }, errors: null,
    };
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
  it("finds exact Italian midnights even on DST transition dates", () => {
    expect(romeMidnightUtc("2026-10-15").toISOString()).toBe("2026-10-14T22:00:00.000Z");
    expect(romeMidnightUtc("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(romeMidnightUtc("2026-10-26").toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(romeMidnightUtc("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(romeMidnightUtc("2026-03-30").toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });
  it("allocates grouped trends without changing the ungrouped total", () => {
    expect(apportion(9, [10, 10, 10])).toEqual([3, 3, 3]);
    expect(apportion(3, [10, 20, 0])).toEqual([1, 2, 0]);
    expect(apportion(0, [10, 10])).toEqual([0, 0]);
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
  it("uses one request for independent Cloudflare totals and matches default 24h filters", async () => {
    const cf = fakeCloudflare([row("2026-10-15T08:00:00Z", 12, 4)]);
    const cfg = config(cf.fn);
    const result = await getAnalytics(cfg, undefined, NOW);
    expect(result).toMatchObject({
      configured: true, today: { visits: 4, pageViews: 12 },
      last24: { visits: 4, pageViews: 12 }, hosts: ["calcioa5.custrento.it"],
      window24: { from: "2026-10-14T10:30:00.000Z", to: "2026-10-15T10:30:00.000Z" },
    });
    expect(cf.calls).toHaveLength(1);
    const { url, headers, body } = cf.calls[0];
    expect(url).toBe("https://api.cloudflare.com/client/v4/graphql");
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(body.query).toContain("hourly: rumPageloadEventsAdaptiveGroups");
    expect(body.query).toContain("last24: rumPageloadEventsAdaptiveGroups(filter: $last24Filter, limit: 1)");
    expect(body.variables.accountTag).toBe(ACCOUNT);
    for (const name of ["todayFilter", "last24Filter", "last7Filter", "last30Filter"]) {
      const filters = body.variables[name].AND;
      expect(filters).toContainEqual({ siteTag: cfg.siteTag });
      expect(filters).toContainEqual({ requestHost_in: ["calcioa5.custrento.it"] });
      expect(filters).not.toContainEqual({ bot: 0 });
      expect(filters).not.toContainEqual({ requestPath_notlike: "/admin%" });
    }
    const range = (name: string) => body.variables[name].AND.find((f: Record<string, string>) => f.datetime_geq);
    expect(range("todayFilter").datetime_geq).toBe("2026-10-14T22:00:00Z");
    expect(range("last24Filter").datetime_geq).toBe("2026-10-14T10:30:00Z");
    expect(range("last7Filter").datetime_geq).toBe("2026-10-08T22:00:00Z");
    expect(range("last30Filter").datetime_geq).toBe("2026-09-15T22:00:00Z");
    expect(range("todayFilter").datetime_leq).toBe("2026-10-15T10:30:00Z");
  });
    it("uses the Cloudflare dashboard's ungrouped totals instead of inflated hourly estimates", async () => {
    // Hourly adaptive sampling estimates 30 for three sampled events,
    // while the ungrouped dashboard query returns 3 visits / 9 page views.
    const cf = fakeCloudflare([row("2026-10-15T08:00:00Z", 30, 30, 10)], {
      ungrouped: { visits: 3, pageViews: 9 },
    });
    const result = await getAnalytics(config(cf.fn), undefined, NOW);
    expect(result).toMatchObject({
      configured: true,
      sampled: true,
      today: { visits: 3, pageViews: 9 },
      last24: { visits: 3, pageViews: 9 },
      last7: { visits: 3, pageViews: 9 },
      last30: { visits: 3, pageViews: 9 },
    });
    if (!result.configured) throw new Error("missing config");
    expect(result.days.at(-1)).toEqual({ date: "2026-10-15", visits: 3, pageViews: 9 });
    expect(result.sampleIntervals.last24).toBe(10);
  });
  it("does not count UTC hours twice across exact Italian-day queries", async () => {
    const cf = fakeCloudflare([
      row("2026-10-13T21:00:00Z", 2, 1), // 23:00 in Rome on the 13th
      row("2026-10-13T22:00:00Z", 3, 1), // 00:00 in Rome on the 14th
      row("2026-10-15T08:00:00Z", 9, 3), // 10:00 in Rome today
    ]);
    const result = await getAnalytics(config(cf.fn), undefined, NOW);
    expect(result).toMatchObject({
      configured: true, today: { visits: 3, pageViews: 9 },
      last7: { visits: 5, pageViews: 14 },
      last30: { visits: 5, pageViews: 14 },
    });
    if (!result.configured) throw new Error("missing config");
    expect(result.days.find((d) => d.date === "2026-10-13")).toMatchObject({ visits: 1, pageViews: 2 });
    expect(result.days.find((d) => d.date === "2026-10-14")).toMatchObject({ visits: 1, pageViews: 3 });
  });
  it("handles the CET/CEST change without duplicating hourly buckets", async () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const cf = fakeCloudflare([
      row("2026-10-24T21:00:00Z", 2, 1),
      row("2026-10-24T22:00:00Z", 3, 1),
      row("2026-10-25T22:00:00Z", 5, 2),
      row("2026-10-25T23:00:00Z", 7, 3),
    ]);
    const result = await getAnalytics(config(cf.fn), undefined, now);
    expect(result).toMatchObject({ configured: true, today: { visits: 3, pageViews: 7 }, last7: { visits: 7, pageViews: 17 } });
  });
  it("cleans the token pasted into the dashboard", async () => {
    const cf = fakeCloudflare([]);
    await getAnalytics(config(cf.fn, { apiToken: '  "Bearer secret-token"\n' }), undefined, NOW);
    expect(cf.calls[0].headers.get("Authorization")).toBe("Bearer secret-token");
    expect(await getAnalytics({ apiToken: "  ", accountId: ACCOUNT, siteTag: SITE }, undefined, NOW)).toEqual({ configured: false, missing: ["CF_ANALYTICS_API_TOKEN"] });
  });
  it("caches results in KV and in memory", async () => {
    const cf = fakeCloudflare([row("2026-10-15T08:00:00Z", 1, 1)]);
    const kv = new MemoryKV();
    const cfg = config(cf.fn);
    await getAnalytics(cfg, kv, NOW);
    await getAnalytics(cfg, kv, new Date(NOW.getTime() + 60_000));
    expect(cf.calls).toHaveLength(1);
    expect([...kv.data.keys()].some((k) => k.startsWith("analytics:v5:"))).toBe(true);
  });
  it("turns Cloudflare failures into readable errors without leaking details", async () => {
    await expect(getAnalytics(config(fakeCloudflare([], { status: 403 }).fn), undefined, NOW)).rejects.toMatchObject({ status: 502, code: "analytics_auth" });
    await expect(getAnalytics(config(fakeCloudflare([], { errors: [{ message: "not authorized for that account" }] }).fn), undefined, NOW)).rejects.toMatchObject({ code: "analytics_auth" });
    await expect(getAnalytics(config(fakeCloudflare([], { errors: [{ message: "internal" }] }).fn), undefined, NOW)).rejects.toMatchObject({ code: "analytics_unavailable" });
    await expect(getAnalytics(config(fakeCloudflare([], { errors: [{ message: "Authentication failed (status: 400)" }] }).fn), undefined, NOW)).rejects.toMatchObject({ code: "analytics_auth", message: expect.stringContaining("non riconosce il token") });
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
  it("has an empty token (off) or a Web Analytics site token", () => {
    expect(app).toMatch(/const CF_WEB_ANALYTICS_TOKEN="(?:[0-9a-f]{32})?";/);
  });
  it("loads with a token on the public host only, whatever the cookie choice", () => {
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
    expect(run("tok", false, "calcioa5.custrento.it")).toHaveLength(1);
    expect(run("tok", true, "cus-trento-c5.pages.dev")).toHaveLength(0);
    expect(run("tok", true, "main.cus-trento-c5.pages.dev")).toHaveLength(0);
    const loaded = run("tok", true, "calcioa5.custrento.it");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(JSON.parse(loaded[0].attrs["data-cf-beacon"])).toEqual({ token: "tok", spa: true });
  });
});
