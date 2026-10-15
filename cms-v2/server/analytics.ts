// Visitor statistics for the dashboard, read from Cloudflare Web Analytics
// (GraphQL Analytics API, dataset rumPageloadEventsAdaptiveGroups).
//
// What the numbers are:
// - Web Analytics is a cookieless browser beacon: it has no "unique visitors".
//   "Visite" = page views whose referer is another site or empty (a new visit);
//   "Pagine viste" = page views. Both are Cloudflare estimates (adaptive sampling).
// - Matches the default Web Analytics view: no optional Exclude Bots or path filters.
// - Only the public hosts are counted (no pages.dev, previews or localhost).
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
      last24: AnalyticsTotals;
      last7: AnalyticsTotals;
      last30: AnalyticsTotals;
      /** UTC bounds of the rolling 24h window, matching Web Analytics' default selection. */
      window24: { from: string; to: string };
      /** Cloudflare can return different estimates for different ranges. */
      sampleIntervals: { today: number; last24: number; last7: number; last30: number; daily: number };
      dailyAvailable: boolean;
      days: AnalyticsDay[];
    };

export const TIME_ZONE = "Europe/Rome";
export const DEFAULT_HOSTS = ["calcioa5.custrento.it"];
const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const CACHE_TTL_SEC = 600;
const DAYS = 30;

const QUERY = `query CmsVisitorStats(
  $accountTag: string!,
  $todayFilter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!,
  $last24Filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!,
  $last7Filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!,
  $last30Filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      today: rumPageloadEventsAdaptiveGroups(filter: $todayFilter, limit: 1) {
        count
        sum { visits }
        avg { sampleInterval }
      }
      last24: rumPageloadEventsAdaptiveGroups(filter: $last24Filter, limit: 1) {
        count
        sum { visits }
        avg { sampleInterval }
      }
      last7: rumPageloadEventsAdaptiveGroups(filter: $last7Filter, limit: 1) {
        count
        sum { visits }
        avg { sampleInterval }
      }
      last30: rumPageloadEventsAdaptiveGroups(filter: $last30Filter, limit: 1) {
        count
        sum { visits }
        avg { sampleInterval }
      }
      hourly: rumPageloadEventsAdaptiveGroups(filter: $last30Filter, limit: 1000, orderBy: [datetimeHour_ASC]) {
        count
        sum { visits }
        avg { sampleInterval }
        dimensions { datetimeHour }
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

/** Exact local midnight for a Rome calendar day, expressed as a UTC instant. */
export function romeMidnightUtc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const midnightUtc = new Date(Date.UTC(year, month - 1, day));
  // Italy is always UTC+1 or UTC+2. At UTC midnight, the local hour is
  // exactly that offset, including on both DST-transition days.
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23",
  }).format(midnightUtc));
  return new Date(midnightUtc.getTime() - hour * 3_600_000);
}

function nextCalendarDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
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
  // V5: direct, independently aggregated totals for each range; optional dashboard filters removed.
  // Bump the cache key so older inflated estimates are never reused.
  const key = `analytics:v5:${cfg.siteTag}:${hosts.join(",")}:${Math.floor(now.getTime() / 1000 / CACHE_TTL_SEC)}`;
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
  const todayStart = romeMidnightUtc(dates[dates.length - 1]);
  const from24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const format = (value: Date) => value.toISOString().replace(/\\.\\d{3}Z$/, "Z");
  const makeFilter = (start: Date) => ({
    AND: [
      { siteTag: cfg.siteTag },
      { datetime_geq: format(start), datetime_leq: format(now) },
      // Match the standard Cloudflare Web Analytics dashboard: no optional
      // "Exclude Bots" or path filters; the siteTag selects the website.
      { requestHost_in: hosts },
    ],
  });
  const variables = {
    accountTag: cfg.accountId,
    todayFilter: makeFilter(todayStart),
    last24Filter: makeFilter(from24),
    last7Filter: makeFilter(romeMidnightUtc(dates[dates.length - 7])),
    last30Filter: makeFilter(romeMidnightUtc(dates[0])),
  };

  // Do not add 30 separate sampled estimates: the sampling rate can change
  // for every query, inflating the result for low-traffic websites.
  const doFetch = cfg.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, "analytics_unavailable", "Cloudflare non risponde: statistiche non disponibili al momento.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(502, "analytics_auth", "Il token Cloudflare non è valido o non ha il permesso Account Analytics: Read.");
  }
  type AccountRows = { today?: Row[]; last24?: Row[]; last7?: Row[]; last30?: Row[]; hourly?: Row[] };
  let response: { data?: { viewer?: { accounts?: AccountRows[] } }; errors?: Array<{ message?: string }> | null } | null = null;
  try {
    response = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok || !response || response.errors?.length) {
    const detail = response?.errors?.map((e) => String(e.message || "")).join("; ").slice(0, 300) || `HTTP ${res.status}`;
    console.error("cms-v2 analytics error", detail);
    if (/authentication failed|invalid (api )?token|unable to authenticate/i.test(detail)) {
      throw new HttpError(502, "analytics_auth", "Cloudflare non riconosce il token in CF_ANALYTICS_API_TOKEN: incolla il valore dell'API token (non l'ID, non la Global API Key, non il token dello snippet Web Analytics).");
    }
    const auth = /not authorized|authentication|permission|access/i.test(detail);
    throw new HttpError(502, auth ? "analytics_auth" : "analytics_unavailable", auth ? "Il token Cloudflare non ha accesso alle statistiche di questo account (serve Account Analytics: Read)." : "Statistiche non disponibili al momento.");
  }
  const account = response.data?.viewer?.accounts?.[0];
  if (!account) throw new HttpError(502, "analytics_auth", "Account Cloudflare non trovato: controlla CF_ACCOUNT_ID e i permessi del token.");

  const metric = (rows: Row[] | undefined): { totals: AnalyticsTotals; interval: number } => {
    if (!Array.isArray(rows)) throw new HttpError(502, "analytics_unavailable", "Cloudflare non ha restituito i totali delle statistiche.");
    // An empty group array is a legitimate zero-event range.
    const row = rows[0];
    return {
      totals: { visits: Math.max(0, Math.round(Number(row?.sum?.visits) || 0)), pageViews: Math.max(0, Math.round(Number(row?.count) || 0)) },
      interval: Math.max(1, Number(row?.avg?.sampleInterval) || 1),
    };
  };
  const today = metric(account.today);
  const last24 = metric(account.last24);
  const last7 = metric(account.last7);
  const last30 = metric(account.last30);
  if (!Array.isArray(account.hourly)) throw new HttpError(502, "analytics_unavailable", "Cloudflare non ha restituito il grafico delle visite.");
  const hourly = summarize(account.hourly, now, hosts);
  const dailyAvailable = last30.totals.pageViews === 0 || hourly.days.some((d) => d.pageViews > 0);
  const visits = apportion(last30.totals.visits, hourly.days.map((d) => d.visits));
  const pageViews = apportion(last30.totals.pageViews, hourly.days.map((d) => d.pageViews));
  const days = hourly.days.map((d, i) => ({ date: d.date, visits: visits[i], pageViews: pageViews[i] }));

  const sampleIntervals = {
    today: today.interval, last24: last24.interval, last7: last7.interval,
    last30: last30.interval, daily: Math.max(1, ...account.hourly.map((r) => Number(r.avg?.sampleInterval) || 1)),
  };
  const payload: Extract<AnalyticsPayload, { configured: true }> = {
    configured: true,
    timezone: TIME_ZONE,
    generatedAt: now.toISOString(),
    hosts,
    sampled: Object.values(sampleIntervals).some((value) => value > 1),
    today: today.totals,
    last24: last24.totals,
    last7: last7.totals,
    last30: last30.totals,
    window24: { from: from24.toISOString(), to: now.toISOString() },
    sampleIntervals,
    dailyAvailable,
    days,
  };
  memoryCache.set(key, { expires: now.getTime() + CACHE_TTL_SEC * 1000, payload });
  if (memoryCache.size > 20) for (const [k, v] of memoryCache) if (v.expires <= now.getTime()) memoryCache.delete(k);
  if (kv) await kv.put(key, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SEC * 2 }).catch(() => undefined);
  return payload;
}
