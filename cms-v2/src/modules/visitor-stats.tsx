// Dashboard card: human visits to the public site from Cloudflare Web Analytics
// (via /api/admin/analytics, which holds the token). Shows only what the API
// returns: no placeholder numbers when it is not configured or fails.
import { useQuery } from "@tanstack/react-query";
import { BarChart3, RefreshCw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/primitives";
import { api, ApiError, type AnalyticsPayload } from "@/lib/api";
import { cn, relativeTime } from "@/lib/utils";

const num = new Intl.NumberFormat("it-IT");
const dayFmt = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" });
// Dates are Italian calendar days (YYYY-MM-DD): format them as-is, without shifting.
const asDay = (iso: string) => new Date(`${iso}T12:00:00Z`);

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-display text-[28px] font-bold leading-none tabular-nums">{num.format(value)}</p>
    </div>
  );
}

function DailyChart({ days }: { days: Extract<AnalyticsPayload, { configured: true }>["days"] }) {
  const [active, setActive] = React.useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.visits));
  const shown = active !== null ? days[active] : null;
  return (
    <figure className="mt-4">
      <figcaption className="flex items-baseline justify-between gap-2 text-xs text-muted">
        <span className="shrink-0 font-semibold text-foreground">Visite al giorno</span>
        <span className="tabular-nums" aria-live="polite">
          {shown ? `${dayFmt.format(asDay(shown.date))} · ${num.format(shown.visits)} visite · ${num.format(shown.pageViews)} pagine` : `max ${num.format(max)}`}
        </span>
      </figcaption>
      <div className="relative mt-2 h-28 border-b border-border" onMouseLeave={() => setActive(null)}>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden />
        <div className="absolute inset-0 flex items-end gap-[2px]" role="group" aria-label="Visite giornaliere">
          {days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              aria-label={`${dayFmt.format(asDay(d.date))}: ${d.visits} visite, ${d.pageViews} pagine viste${i === days.length - 1 ? " (oggi, in corso)" : ""}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(active === i ? null : i)}
              className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-none"
            >
              <span
                className={cn("block w-full rounded-t-[4px] bg-primary transition-opacity", i === days.length - 1 && "opacity-60", active !== null && active !== i && "opacity-40", "group-focus-visible:ring-2 group-focus-visible:ring-ring")}
                style={{ height: d.visits ? `${Math.max(3, (d.visits / max) * 100)}%` : "0" }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted tabular-nums" aria-hidden>
        <span>{shortFmt.format(asDay(days[0].date))}</span>
        <span>{shortFmt.format(asDay(days[Math.floor(days.length / 2)].date))}</span>
        <span>oggi</span>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted">Tabella giornaliera</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead><tr className="text-left text-muted"><th className="font-medium">Giorno</th><th className="text-right font-medium">Visite</th><th className="text-right font-medium">Pagine viste</th></tr></thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.date} className="border-t border-border"><td className="py-1">{dayFmt.format(asDay(d.date))}</td><td className="text-right">{num.format(d.visits)}</td><td className="text-right">{num.format(d.pageViews)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function VisitorStats() {
  const q = useQuery({ queryKey: ["analytics"], queryFn: () => api.analytics(), staleTime: 5 * 60_000, retry: 1 });
  const data = q.data;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold">Visite al sito</h2>
          {data?.configured && <p className="text-xs text-muted">{data.hosts.join(", ")} · ora italiana</p>}
        </div>
        {(data?.configured || q.isError) && (
          <Button variant="ghost" size="icon-sm" className="-mr-2 -mt-1" aria-label="Aggiorna statistiche" disabled={q.isFetching} onClick={() => q.refetch()}>
            <RefreshCw className={cn("size-4", q.isFetching && "animate-spin")} />
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <Skeleton className="mt-3 h-56" />
      ) : q.isError ? (
        <p className="mt-3 rounded-xl bg-warning-soft px-3 py-2.5 text-sm text-warning">{q.error instanceof ApiError ? q.error.message : "Statistiche non disponibili al momento."}</p>
      ) : data && !data.configured ? (
        <div className="mt-3 flex items-start gap-3 text-sm">
          <BarChart3 className="mt-0.5 size-5 shrink-0 text-muted" />
          <div>
            <p className="font-semibold">Statistiche non configurate</p>
            <p className="text-muted">Mancano le impostazioni Cloudflare: {data.missing.join(", ")}. Istruzioni in cms-v2/README.md.</p>
          </div>
        </div>
      ) : data?.configured ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Tile label="Visite oggi" value={data.today.visits} />
            <Tile label="Visite 7 giorni" value={data.last7.visits} />
            <Tile label="Visite 30 giorni" value={data.last30.visits} />
            <Tile label="Pagine viste 30 giorni" value={data.last30.pageViews} />
          </div>
          <DailyChart days={data.days} />
          <p className="mt-3 text-[11px] leading-snug text-muted">
            Stime di Cloudflare Web Analytics{data.sampled ? " (dati campionati)" : ""}.
            Esclusi bot e crawler riconosciuti (motori di ricerca, AI), il CMS e le anteprime; inclusi gli utenti arrivati dai motori di ricerca.
            Non sono visitatori unici: una visita inizia arrivando da un altro sito o da un link diretto. Aggiornato {relativeTime(data.generatedAt)}.
          </p>
        </>
      ) : null}
    </Card>
  );
}
