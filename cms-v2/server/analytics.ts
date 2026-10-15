// Visitor statistics for the dashboard, read from Cloudflare Web Analytics
// (GraphQL Analytics API, dataset rumPageloadEventsAdaptiveGroups).
//
// What the numbers are:
// - Web Analytics is a cookieless browser beacon: it has no "unique visitors".
//   "Visite" = page views whose referer is another site or empty (a new visit);
//   "Pagine viste" = page views. Both are Cloudflare estimates (adaptive sampling).
// - bot = 0 excludes traffic Cloudflare flags as automated (crawlers, AI bots,
//   Googlebot, Bingbot…); people arriving from search engines are kept.
// - Only the public hosts are counted (no pages.dev, previews or localhost),
//   and /admin* paths are excluded.
// - Days are calendar days in Europe/Rome.
// The API token stays on the server (Pages secret); the browser only sees the totals.
import { HttpError } from "./errors";
import type { KV } from "./guards";

export interface AnalyticsConfig {
  apiToken?: string;
  accountId?: string;
  siteTag?: string;
  /** Comma-separated public hostnames; default calcioa5.custrento.it. */
  hosts?: string;
  /** Tests inject a fake fetch. */
  fetch?: typeof fetch;
}

export interface AnalyticsDay { date: string; visits: number; pageViews: number }
export interface AnalyticsTotals { visits: number; pageViews: number }
export type AnalyticsPayload =
  | { configured: false; missing: string[] }
  | {
      configured: true;
      timezone: typeof TIME_ZONE;
      generatedAt: string;
      hosts: string[];
      sampled: boolean;
      today: AnalyticsTotals;
      last7: AnalyticsTotals;
      last30: AnalyticsTotals;
      days: AnalyticsDay[];
    };

export const TIME_ZONE = "Europe/Rome";
export const DEFAULT_HOSTS = ["calcioa5.custrento.it"];
const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const CACHE_TTL_SEC = 600;
const DAYS = 30;

const QUERY = `query CmsVisitorStats($accountTag: string!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      hourly: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1000, orderBy: [datetimeHour_ASC]) {
        count
        sum { visits }
        avg { sampleInterval }
        dimensions { datetimeHour }
      }
      total: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1) {
        count
        sum { visits }
        avg { sampleInterval }
      }
    }
  }
}`;

const romeDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
/** YYYY-MM-DD of an instant, in Italian time. */
export const romeDate = (d: Date) => romeDateFmt.format(d);

/** The last `count` Italian calendar dates, oldest first, ending with today's. */
export function lastRomeDates(now: Date, count = DAYS): string[] {
  const today = romeDate(now);
  const [y, m, d] = today.split("-").map(Number);
  const out: string[] = [];
  // Date arithmetic on the calendar date itself (UTC noon) is immune to DST.
  for (let i = count - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d - i, 12)).toISOString().slice(0, 10));
  return out;
}

export function parseHosts(value: string | undefined): string[] {
  const hosts = String(value || "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) && !h.endsWith(".pages.dev"));
  return hosts.length ? [...new Set(hosts)] : DEFAULT_HOSTS;
}

export function missingConfig(cfg: AnalyticsConfig): string[] {
  const missing: string[] = [];
  if (!cfg.apiToken) missing.push("CF_ANALYTICS_API_TOKEN");
  if (!cfg.accountId || !/^[0-9a-f]{32}$/i.test(cfg.accountId)) missing.push("CF_ACCOUNT_ID");
  if (!cfg.siteTag || !/^[0-9a-f]{32}$/i.test(cfg.siteTag)) missing.push("CF_WEB_ANALYTICS_SITE_TAG");
  return missing;
}

interface Row { count?: number; sum?: { visits?: number }; avg?: { sampleInterval?: number }; dimensions?: { datetimeHour?: string } }

/** Groups hourly rows (UTC) into Italian calendar days. Italy's offset is a whole number of hours, so no hour straddles two days. */
export function summarize(rows: Row[], now: Date, hosts: string[]): Extract<AnalyticsPayload, { configured: true }> {
  const dates = lastRomeDates(now);
  const byDate = new Map(dates.map((date) => [date, { date, visits: 0, pageViews: 0 }]));
  let sampled = false;
  for (const row of rows) {
    const hour = row.dimensions?.datetimeHour;
    const t = hour ? new Date(hour) : null;
    if (!t || Number.isNaN(t.getTime())) continue;
    const day = byDate.get(romeDate(t));
    if (!day) continue;
    day.pageViews += Math.max(0, Math.round(Number(row.count) || 0));
    day.visits += Math.max(0, Math.round(Number(row.sum?.visits) || 0));
    if ((Number(row.avg?.sampleInterval) || 1) > 1) sampled = true;
  }
  const days = [...byDate.values()];
  const total = (list: AnalyticsDay[]) => list.reduce((acc, d) => ({ visits: acc.visits + d.visits, pageViews: acc.pageViews + d.pageViews }), { visits: 0, pageViews: 0 });
  return {
    configured: true,
    timezone: TIME_ZONE,
    generatedAt: now.toISOString(),
    hosts,
    sampled,
    today: total(days.slice(-1)),
    last7: total(days.slice(-7)),
    last30: total(days),
    days,
  };
}

/**
 * Allocate an ungrouped Cloudflare total over the hourly distribution.
 * GraphQL's adaptive hourly and ungrouped estimates can differ markedly
 * with sparse data; the dashboard uses an ungrouped total.
 */
export function apportion(total: number, weights: number[]): number[] {
  const value = Math.max(0, Math.round(Number(total) || 0));
  const positive = weights.map((n) => Math.max(0, Number(n) || 0));
  const sum = positive.reduce((a, b) => a + b, 0);
  if (!positive.length) return [];
  if (sum === 0) return positive.map(() => 0);
  const precise = positive.map((w) => value * w / sum);
  const out = precise.map(Math.floor);
  let remainder = value - out.reduce((a, b) => a + b, 0);
  const order = precise.map((v, i) => ({ i, fraction: v - out[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (const { i } of order) {
    if (remainder-- <= 0) break;
    out[i]++;
  }
  return out;
}

const memoryCache = new Map<string, { expires: number; payload: AnalyticsPayload }>();

/** Tolerates what a copy-paste into the dashboard tends to add: spaces, newlines, quotes, a "Bearer " prefix. */
export const cleanToken = (value: string | undefined) => String(value || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();

export async function getAnalytics(cfg: AnalyticsConfig, kv: KV | undefined, now = new Date()): Promise<AnalyticsPayload> {
  cfg = { ...cfg, apiToken: cleanToken(cfg.apiToken) || undefined };
  const missing = missingConfig(cfg);
  if (missing.length) return { configured: false, missing };
  const hosts = parseHosts(cfg.hosts);
  // V2: split the monthly range to reduce adaptive sampling. Bump the
  // cache namespace so cached V1 estimates cannot be displayed by V2.
  const key = `analytics:v3:${cfg.siteTag}:${hosts.join(",")}:${Math.floor(now.getTime() / 1000 / CACHE_TTL_SEC)}`;
  const mem = memoryCache.get(key);
  if (mem && mem.expires > now.getTime()) return mem.payload;
  if (kv) {
    const cached = await kv.get(key).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as AnalyticsPayload;
      } catch {
        /* ignore a corrupt entry and refetch */
      }
    }
  }

  const dates = lastRomeDates(now);
  // Cloudflare's 30-day adaptive query can exaggerate small totals.
  // Query the most recent seven Italian calendar days individually, and
  // the preceding 23 days in groups of at most seven days. This retains
  // hourly points for the graph while avoiding one large monthly sample.
  const periods: string[][] = [];
  const older = dates.slice(0, -7);
  for (let i = 0; i < older.length; i += 7) periods.push(older.slice(i, i + 7));
  for (const day of dates.slice(-7)) periods.push([day]);

  const doFetch = cfg.fetch ?? fetch;
  const readPeriod = async (period: string[]): Promise<{ dates: string[]; rows: Row[]; total: AnalyticsTotals; sampled: boolean }> => {
    // UTC bounds deliberately overlap adjoining periods by one day because
    // local midnight changes with CET/CEST. Filter by actual Rome date below,
    // otherwise overlapping API windows would double-count page views.
    const start = new Date(Date.parse(`${period[0]}T00:00:00Z`) - 86_400_000);
    const afterLast = Date.parse(`${period[period.length - 1]}T00:00:00Z`) + 2 * 86_400_000;
    const finish = new Date(Math.min(afterLast, now.getTime()));
    const filter = {
      AND: [
        { siteTag: cfg.siteTag },
        { datetime_geq: start.toISOString().replace(/\.\d{3}Z$/, "Z"), datetime_leq: finish.toISOString().replace(/\.\d{3}Z$/, "Z") },
        { bot: 0 },
        { requestHost_in: hosts },
        { requestPath_notlike: "/admin%" },
      ],
    };
    let res: Response;
    try {
      res = await doFetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { accountTag: cfg.accountId, filter } }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new HttpError(502, "analytics_unavailable", "Cloudflare non risponde: statistiche non disponibili al momento.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(502, "analytics_auth", "Il token Cloudflare non è valido o non ha il permesso Account Analytics: Read.");
    }
    let body: { data?: { viewer?: { accounts?: Array<{ hourly?: Row[]; total?: Array<Row> }> } }; errors?: Array<{ message?: string }> | null } | null = null;
    try {
      body = await res.json();
    } catch {
      /* handled below */
    }
    if (!res.ok || !body || body.errors?.length) {
      const detail = body?.errors?.map((e) => String(e.message || "")).join("; ").slice(0, 300) || `HTTP ${res.status}`;
      console.error("cms-v2 analytics error", detail);
      if (/authentication failed|invalid (api )?token|unable to authenticate/i.test(detail)) {
        throw new HttpError(502, "analytics_auth", "Cloudflare non riconosce il token in CF_ANALYTICS_API_TOKEN: incolla il valore dell'API token (non l'ID, non la Global API Key, non il token dello snippet Web Analytics).");
      }
      const auth = /not authorized|authentication|permission|access/i.test(detail);
      throw new HttpError(502, auth ? "analytics_auth" : "analytics_unavailable", auth ? "Il token Cloudflare non ha accesso alle statistiche di questo account (serve Account Analytics: Read)." : "Statistiche non disponibili al momento.");
    }
    const accounts = body.data?.viewer?.accounts;
    if (!accounts?.length) throw new HttpError(502, "analytics_auth", "Account Cloudflare non trovato: controlla CF_ACCOUNT_ID e i permessi del token.");
    const allowed = new Set(period);
    const rows = (accounts[0].hourly || []).filter((row) => {
      const date = row.dimensions?.datetimeHour;
      const hour = date ? new Date(date) : null;
      return hour && !Number.isNaN(hour.getTime()) && allowed.has(romeDate(hour));
    });
    // The Cloudflare Web Analytics dashboard uses this ungrouped (limit: 1)
    // aggregation for its Visits and Page views summary.
    const aggregate = accounts[0].total?.[0];
    if (!aggregate) throw new HttpError(502, "analytics_unavailable", "Cloudflare non ha restituito i totali delle statistiche.");
    return {
      dates: period,
      rows,
      total: {
        visits: Math.max(0, Math.round(Number(aggregate.sum?.visits) || 0)),
        pageViews: Math.max(0, Math.round(Number(aggregate.count) || 0)),
      },
      sampled: (Number(aggregate.avg?.sampleInterval) || 1) > 1,
    };
  };

  const chunks = await Promise.all(periods.map(readPeriod));
  const payload = summarize(chunks.flatMap((chunk) => chunk.rows), now, hosts);
  for (const chunk of chunks) {
    const daily = chunk.dates.map((date) => payload.days.find((day) => day.date === date)!);
    const visits = apportion(chunk.total.visits, daily.map((day) => day.visits));
    const pageViews = apportion(chunk.total.pageViews, daily.map((day) => day.pageViews));
    daily.forEach((day, i) => {
      day.visits = visits[i];
      day.pageViews = pageViews[i];
    });
  }
  // Compute headline numbers from *ungrouped* totals, rather than summing
  // grouped hourly estimates that can inflate tiny traffic by 10x.
  const add = (totals: AnalyticsTotals[]) => totals.reduce((a, b) => ({
    visits: a.visits + b.visits, pageViews: a.pageViews + b.pageViews,
  }), { visits: 0, pageViews: 0 });
  payload.today = chunks[chunks.length - 1].total;
  payload.last7 = add(chunks.slice(-7).map((chunk) => chunk.total));
  payload.last30 = add(chunks.map((chunk) => chunk.total));
  payload.sampled ||= chunks.some((chunk) => chunk.sampled);

  memoryCache.set(key, { expires: now.getTime() + CACHE_TTL_SEC * 1000, payload });
  if (memoryCache.size > 20) for (const [k, v] of memoryCache) if (v.expires <= now.getTime()) memoryCache.delete(k);
  if (kv) await kv.put(key, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SEC * 2 }).catch(() => undefined);
  return payload;
}
