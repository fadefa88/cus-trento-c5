import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, CheckCircle2, CircleAlert, CircleDashed, ClipboardCheck, FileClock, ImagePlus, Newspaper, Trophy, UserPlus } from "lucide-react";
import * as React from "react";
import { isCusName } from "@shared/rules";
import { MatchCard } from "@/modules/matches";
import { useSession } from "@/components/shell";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useDocument, useDocumentsSummary } from "@/lib/docs";
import { href, navigate } from "@/lib/router";
import { cn, formatDate, relativeTime, todayIso } from "@/lib/utils";

type Item = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

function QuickAction({ icon: Icon, label, description, onClick, tone = "default" }: { icon: React.ComponentType<{ className?: string }>; label: string; description?: string; onClick: () => void; tone?: "default" | "primary" }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-h-[92px] flex-col justify-between gap-2 rounded-2xl border p-3.5 text-left transition-transform active:scale-[0.98]", tone === "primary" ? "border-primary bg-primary text-white" : "border-border bg-surface")}>
      <Icon className={cn("size-6", tone === "primary" ? "text-white" : "text-primary")} />
      <span>
        <span className="block font-semibold leading-tight">{label}</span>
        {description && <span className={cn("block text-xs", tone === "primary" ? "text-white/80" : "text-muted")}>{description}</span>}
      </span>
    </button>
  );
}

export function Dashboard() {
  const session = useSession();
  const prima = useDocument<{ fixtures: Item[] }>("fixtures");
  const u23 = useDocument<{ u21Fixtures: Item[] }>("u21Fixtures");
  const docs = useDocumentsSummary();
  const status = useQuery({ queryKey: ["status"], queryFn: () => api.status(), refetchInterval: 30_000 });
  const news = useQuery({
    queryKey: ["public-news"],
    queryFn: async () => {
      const res = await fetch("/content/news.index.json", { cache: "no-cache" });
      if (!res.ok) return [];
      const data = (await res.json()) as Item[] | { news?: Item[] };
      return (Array.isArray(data) ? data : data.news) || [];
    },
    staleTime: 5 * 60_000,
  });
  const cmsNews = useDocument<{ news: Item[] }>("news");

  const all = [
    ...(prima.content?.fixtures || []).map((m) => ({ m, team: "prima" as const })),
    ...(u23.content?.u21Fixtures || []).map((m) => ({ m, team: "u23" as const })),
  ];
  const today = todayIso();
  const upcoming = all.filter((x) => x.m.status !== "Terminata" && str(x.m.date) >= today).sort((a, b) => `${str(a.m.date)}${str(a.m.time)}`.localeCompare(`${str(b.m.date)}${str(b.m.time)}`)).slice(0, 4);
  const results = all.filter((x) => x.m.status === "Terminata").sort((a, b) => str(b.m.date).localeCompare(str(a.m.date))).slice(0, 4);
  const toResult = all.filter((x) => x.m.status !== "Terminata" && str(x.m.date) < today && str(x.m.date)).sort((a, b) => str(b.m.date).localeCompare(str(a.m.date)));
  const drafts = (docs.data?.documents || []).filter((d) => d.draft);
  const latestNews = [...(cmsNews.content?.news || []), ...(news.data || [])].sort((a, b) => str(b.date).localeCompare(str(a.date))).slice(0, 5);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
  const checks = status.data?.checks;
  const loading = prima.isLoading || u23.isLoading;

  return (
    <div className="pt-5 lg:pt-10">
      <p className="text-sm text-muted">{new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p>
      <h1 className="font-display text-[34px] font-bold leading-tight lg:text-[44px]">{greeting}{session.data ? `, ${session.data.name.split(" ")[0]}` : ""}</h1>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {toResult[0] ? (
          <QuickAction tone="primary" icon={ClipboardCheck} label="Inserisci risultato" description={`${str(toResult[0].m.home)} – ${str(toResult[0].m.away)}`} onClick={() => navigate(`/partite/${toResult[0].team}`, { edit: str(toResult[0].m.id) })} />
        ) : (
          <QuickAction tone="primary" icon={CalendarPlus} label="Nuova partita" description="Prima squadra" onClick={() => navigate("/partite/prima", { edit: "new" })} />
        )}
        <QuickAction icon={Trophy} label="Risultato League" description="Partite e marcatori" onClick={() => navigate("/league", { tab: "partite" })} />
        <QuickAction icon={Newspaper} label="Scrivi news" onClick={() => navigate("/news", { edit: "new" })} />
        <QuickAction icon={UserPlus} label="Aggiungi giocatore" onClick={() => navigate("/rosa", { edit: "new" })} />
        <QuickAction icon={CalendarPlus} label="Partita U23" onClick={() => navigate("/partite/u23", { edit: "new" })} />
        <QuickAction icon={ImagePlus} label="Nuovo album" onClick={() => navigate("/gallery", { edit: "new" })} />
      </section>

      {toResult.length > 1 && (
        <p className="mt-3 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">{toResult.length} partite giocate attendono il risultato.</p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-8">
          <section>
            <div className="mb-3 flex items-end justify-between"><h2 className="font-display text-2xl font-bold">Prossime partite</h2><a href={href("/partite/prima")} className="text-sm font-semibold text-primary">Calendario</a></div>
            {loading ? <Skeleton className="h-48" /> : upcoming.length ? <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">{upcoming.map(({ m, team }) => <li key={team + str(m.id)}><MatchCard m={m} team={team} onOpen={() => navigate(`/partite/${team}`, { edit: str(m.id) })} /></li>)}</ul> : <p className="text-sm text-muted">Nessuna partita in programma.</p>}
          </section>
          <section>
            <h2 className="mb-3 font-display text-2xl font-bold">Ultimi risultati</h2>
            {loading ? <Skeleton className="h-48" /> : <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">{results.map(({ m, team }) => <li key={team + str(m.id)}><MatchCard m={m} team={team} onOpen={() => navigate(`/partite/${team}`, { edit: str(m.id) })} /></li>)}</ul>}
          </section>
          <section>
            <div className="mb-3 flex items-end justify-between"><h2 className="font-display text-2xl font-bold">News recenti</h2><a href={href("/news")} className="text-sm font-semibold text-primary">Tutte</a></div>
            <Card className="divide-y divide-border">
              {latestNews.map((n, i) => (
                <div key={str(n.id) + i} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-16 shrink-0 text-xs text-muted">{formatDate(n.date).replace(/ \d{4}$/, "")}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px]">{str(n.title)}</span>
                  {n.importedFrom ? <Badge>SporTrentino</Badge> : <Badge tone="primary">CMS</Badge>}
                </div>
              ))}
              {!latestNews.length && <p className="px-4 py-6 text-sm text-muted">Nessuna news.</p>}
            </Card>
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <Card className="p-4">
            <h2 className="font-display text-xl font-bold">Stato pubblicazione</h2>
            <div className="mt-3 flex items-center gap-3">
              {checks?.state === "success" ? <CheckCircle2 className="size-8 text-success" /> : checks?.state === "failure" ? <CircleAlert className="size-8 text-danger" /> : <CircleDashed className={cn("size-8 text-warning", checks?.state === "pending" && "animate-spin [animation-duration:3s]")} />}
              <div className="text-sm">
                <p className="font-semibold">{checks?.state === "success" ? "Sito aggiornato" : checks?.state === "failure" ? "Errore nell'ultima pubblicazione" : checks?.state === "pending" ? "Pubblicazione in corso…" : "Stato non disponibile"}</p>
                <p className="text-muted">Ultima versione {status.data?.head?.slice(0, 7) ?? "…"}</p>
              </div>
            </div>
            {checks?.items.length ? (
              <ul className="mt-3 space-y-1 text-xs">
                {checks.items.slice(0, 5).map((c) => <li key={c.name} className="flex justify-between gap-2"><span className="truncate text-muted">{c.name}</span><span className={cn("font-semibold", ["success", "completed"].includes(c.status) ? "text-success" : ["failure", "error"].includes(c.status) ? "text-danger" : "text-warning")}>{c.status}</span></li>)}
              </ul>
            ) : null}
            <a href={href("/pubblica")} className={cn("mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold", drafts.length ? "bg-warning-soft text-warning" : "bg-surface-2 text-muted")}>
              <FileClock className="size-4" />{drafts.length ? `${drafts.length} bozz${drafts.length === 1 ? "a" : "e"} da pubblicare` : "Nessuna bozza in sospeso"}
            </a>
          </Card>
          <Card className="p-4">
            <h2 className="font-display text-xl font-bold">Ultime modifiche</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {(status.data?.recent || []).slice(0, 8).map((c) => (
                <li key={c.sha} className="text-sm">
                  <p className="line-clamp-2 font-medium">{c.title.replace(/^CMS: /, "")}</p>
                  <p className="text-xs text-muted">{c.actor} · {relativeTime(c.date)}</p>
                </li>
              ))}
              {status.isLoading && <Skeleton className="h-32" />}
            </ul>
          </Card>
          {all.some((x) => !isCusName(x.m.home) && !isCusName(x.m.away)) && (
            <Card className="border-warning p-4 text-sm">
              <p className="font-semibold">Controllo dati</p>
              <p className="text-muted">{all.filter((x) => !isCusName(x.m.home) && !isCusName(x.m.away)).length} partite non contengono “CUS Trento” nel nome di nessuna squadra e restano fuori dalle statistiche.</p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
