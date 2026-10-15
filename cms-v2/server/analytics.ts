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
      rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1000, orderBy: [datetimeHour_ASC]) {
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

const memoryCache = new Map<string, { expires: number; payload: AnalyticsPayload }>();

export async function getAnalytics(cfg: AnalyticsConfig, kv: KV | undefined, now = new Date()): Promise<AnalyticsPayload> {
  const missing = missingConfig(cfg);
  if (missing.length) return { configured: false, missing };
  const hosts = parseHosts(cfg.hosts);
  // One entry per 10-minute slot: every admin opening the dashboard shares it.
  const key = `analytics:v1:${cfg.siteTag}:${hosts.join(",")}:${Math.floor(now.getTime() / 1000 / CACHE_TTL_SEC)}`;
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
  // One extra day on each side: the hourly rows are bucketed by Italian date afterwards.
  const start = new Date(Date.parse(`${dates[0]}T00:00:00Z`) - 86_400_000);
  const filter = {
    AND: [
      { siteTag: cfg.siteTag },
      { datetime_geq: start.toISOString().replace(/\.\d{3}Z$/, "Z"), datetime_leq: now.toISOString().replace(/\.\d{3}Z$/, "Z") },
      { bot: 0 },
      { requestHost_in: hosts },
      { requestPath_notlike: "/admin%" },
    ],
  };

  const doFetch = cfg.fetch ?? fetch;
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
  let body: { data?: { viewer?: { accounts?: Array<{ rumPageloadEventsAdaptiveGroups?: Row[] }> } }; errors?: Array<{ message?: string }> | null } | null = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok || !body || body.errors?.length) {
    const detail = body?.errors?.map((e) => String(e.message || "")).join("; ").slice(0, 300) || `HTTP ${res.status}`;
    console.error("cms-v2 analytics error", detail);
    const auth = /not authorized|authentication|permission/i.test(detail);
    throw new HttpError(502, auth ? "analytics_auth" : "analytics_unavailable", auth ? "Il token Cloudflare non ha accesso alle statistiche di questo account (serve Account Analytics: Read)." : "Statistiche non disponibili al momento.");
  }
  const accounts = body.data?.viewer?.accounts;
  if (!accounts?.length) throw new HttpError(502, "analytics_auth", "Account Cloudflare non trovato: controlla CF_ACCOUNT_ID e i permessi del token.");
  const payload = summarize(accounts[0].rumPageloadEventsAdaptiveGroups || [], now, hosts);

  memoryCache.set(key, { expires: now.getTime() + CACHE_TTL_SEC * 1000, payload });
  if (memoryCache.size > 20) for (const [k, v] of memoryCache) if (v.expires <= now.getTime()) memoryCache.delete(k);
  if (kv) await kv.put(key, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SEC * 2 }).catch(() => undefined);
  return payload;
}
