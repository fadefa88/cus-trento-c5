import { CalendarDays, ExternalLink, Plus, Search, Shield } from "lucide-react";
import * as React from "react";
import { COMPETITIONS, MAX_BENCH, OWN_GOAL_ID, type DocumentId } from "@shared/documents";
import { isCusName, scoreParts } from "@shared/rules";
import { publicUrl } from "@shared/site";
import { FormSection, ItemEditor } from "@/components/editor";
import { DateField, ImageField, SelectField, TextField, TimeField, ToggleRow } from "@/components/fields";
import { GoalTimes, PlayerButton, PlayerMultiPicker, RowCard, Stepper, type PlayerChoice } from "@/components/match-ui";
import { DraftBanner, PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { SearchPicker } from "@/components/ui/dialogs";
import { Badge, Card, EmptyState, Field, Input, SegmentedControl, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { useDocument } from "@/lib/docs";
import { setQuery, useRoute } from "@/lib/router";
import { cn, formatDate, imageUrl, matchesSearch, todayIso } from "@/lib/utils";
import { teamLabel } from "./roster";

type Item = Record<string, unknown>;
type Ev = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");
const arr = <T = Ev,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const TEAMS = {
  prima: { doc: "fixtures" as DocumentId, label: "Prima squadra", cusName: "CUS Trento", youth: false, collection: "fixtures" },
  u23: { doc: "u21Fixtures" as DocumentId, label: "Under 23", cusName: "CUS Trento U23", youth: true, collection: "u21Fixtures" },
};
type TeamKey = keyof typeof TEAMS;

export function eventTimes(e: Ev): string[] {
  const list = arr<Ev | string>(e.goalTimes).map((t) => (typeof t === "object" && t ? str((t as Ev).time) : str(t))).filter(Boolean);
  if (list.length) return list;
  return e.minute ? [str(e.minute)] : [];
}

/** Stores goal times the way the site reads them: one time in `minute`, several in `goalTimes`. */
export function withTimes(e: Ev, times: string[]): Ev {
  const clean = times.map((t) => t.trim()).filter(Boolean);
  const out = { ...e };
  delete out.minute;
  delete out.goalTimes;
  if (clean.length === 1) out.minute = clean[0];
  else if (clean.length > 1) out.goalTimes = clean.map((time) => ({ time }));
  return out;
}

function cusSide(m: Item): "home" | "away" {
  return isCusName(m.home) ? "home" : isCusName(m.away) ? "away" : "home";
}

function opponentName(m: Item) {
  return cusSide(m) === "home" ? str(m.away) : str(m.home);
}

export function MatchCard({ m, onOpen, team }: { m: Item; onOpen: () => void; team: TeamKey }) {
  const score = scoreParts(m.score);
  const done = m.status === "Terminata";
  const side = cusSide(m);
  const result = done && score ? (score[side === "home" ? 0 : 1] > score[side === "home" ? 1 : 0] ? "V" : score[0] === score[1] ? "N" : "P") : null;
  const url = publicUrl(TEAMS[team].collection, m);
  return (
    <Card className="flex items-stretch overflow-hidden">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left">
        <div className="grid w-14 shrink-0 place-items-center rounded-xl bg-surface-2 py-2 text-center leading-none">
          <span className="text-[11px] font-semibold uppercase text-muted">{formatDate(m.date, true).split(" ")[0]}</span>
          <span className="font-display text-2xl font-bold tabular">{str(m.date).slice(8, 10) || "–"}</span>
          <span className="text-[11px] uppercase text-muted">{formatDate(m.date).split(" ")[1]}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px]"><span className={cn(isCusName(m.home) && "font-semibold")}>{str(m.home) || "?"}</span></p>
          <p className="truncate text-[15px]"><span className={cn(isCusName(m.away) && "font-semibold")}>{str(m.away) || "?"}</span></p>
          <p className="mt-0.5 truncate text-xs text-muted">{[m.time, m.venue, m.competition].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {done && score ? (
            <span className="font-display text-2xl font-bold leading-none tabular">{score[0]}<span className="px-0.5 text-muted">-</span>{score[1]}</span>
          ) : (
            <Badge>Da giocare</Badge>
          )}
          {result && <Badge tone={result === "V" ? "success" : result === "N" ? "neutral" : "danger"}>{result === "V" ? "Vittoria" : result === "N" ? "Pareggio" : "Sconfitta"}</Badge>}
          {!!m.opponentLogo && <img src={imageUrl(m.opponentLogo)} alt="" className="size-7 object-contain" />}
        </div>
      </button>
      {url && <a href={url} target="_blank" rel="noreferrer" aria-label="Apri sul sito" className="grid w-11 shrink-0 place-items-center border-l border-border text-muted hover:bg-surface-2"><ExternalLink className="size-4" /></a>}
    </Card>
  );
}

export function MatchesPage({ team }: { team: TeamKey }) {
  const cfg = TEAMS[team];
  const route = useRoute();
  const { content, isLoading, hasDraft } = useDocument(cfg.doc);
  const roster = useDocument<{ roster: Item[] }>("roster");
  const other = useDocument(team === "prima" ? "u21Fixtures" : "fixtures");
  const [filter, setFilter] = React.useState<"all" | "Campionato" | "Coppa">("all");
  const [search, setSearch] = React.useState("");
  const matches = arr<Item>(content?.[cfg.doc]);
  const visible = matches.filter((m) => (filter === "all" || (m.competition || "Campionato") === filter) && matchesSearch(search, m.home, m.away, m.venue, m.date));
  const upcoming = visible.filter((m) => m.status !== "Terminata").sort((a, b) => str(a.date).localeCompare(str(b.date)));
  const played = visible.filter((m) => m.status === "Terminata").sort((a, b) => str(b.date).localeCompare(str(a.date)));
  const editId = route.query.get("edit");
  const editing = editId && editId !== "new" ? matches.find((m) => String(m.id) === editId) || null : null;
  const opponents = React.useMemo(() => {
    const names = new Set<string>();
    for (const m of [...matches, ...arr<Item>(other.content?.[team === "prima" ? "u21Fixtures" : "fixtures"])]) for (const n of [m.home, m.away]) if (n && !isCusName(n)) names.add(str(n));
    return [...names].sort((a, b) => a.localeCompare(b, "it"));
  }, [matches, other.content, team]);
  const logos = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const m of matches) if (m.opponentLogo) map.set(opponentName(m).toLowerCase(), str(m.opponentLogo));
    return map;
  }, [matches]);
  const cusName = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of matches) for (const n of [m.home, m.away]) if (isCusName(n)) counts.set(str(n), (counts.get(str(n)) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || cfg.cusName;
  }, [matches, cfg.cusName]);

  return (
    <>
      <PageHeader title={`Calendario ${cfg.label}`} eyebrow="Match center" actions={<Button onClick={() => setQuery({ edit: "new" })} className="hidden sm:inline-flex"><Plus />Nuova partita</Button>}>
        <SegmentedControl value={team} onChange={(t) => (window.location.hash = `#/partite/${t}`)} options={[{ value: "prima", label: "Prima squadra" }, { value: "u23", label: "Under 23" }]} className="w-full sm:w-auto" />
      </PageHeader>
      <DraftBanner doc={cfg.doc} />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input type="search" placeholder="Cerca avversario, campo, data…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <SegmentedControl value={filter} onChange={setFilter} options={[{ value: "all", label: "Tutte" }, { value: "Campionato", label: "Campionato" }, { value: "Coppa", label: "Coppa" }]} />
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : !matches.length ? (
        <EmptyState icon={CalendarDays} title="Nessuna partita" action={<Button onClick={() => setQuery({ edit: "new" })}><Plus />Aggiungi partita</Button>} />
      ) : (
        <div className="flex flex-col gap-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-2xl font-bold">Prossime partite <span className="text-muted">{upcoming.length}</span></h2>
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">{upcoming.map((m) => <li key={str(m.id)}><MatchCard m={m} team={team} onOpen={() => setQuery({ edit: str(m.id) })} /></li>)}</ul>
            </section>
          )}
          {played.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-2xl font-bold">Risultati <span className="text-muted">{played.length}</span></h2>
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">{played.map((m) => <li key={str(m.id)}><MatchCard m={m} team={team} onOpen={() => setQuery({ edit: str(m.id) })} /></li>)}</ul>
            </section>
          )}
        </div>
      )}
      <button type="button" onClick={() => setQuery({ edit: "new" })} aria-label="Nuova partita" className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-20 grid size-14 place-items-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/30 active:scale-95 sm:hidden"><Plus className="size-7" /></button>
      <ItemEditor<Item>
        doc={cfg.doc}
        list={[cfg.doc]}
        item={editing}
        open={!!editId && (editId === "new" || !!editing)}
        onClose={() => setQuery({ edit: null }, { force: true })}
        hasDraft={hasDraft}
        wide
        context={{ roster: roster.content?.roster || [] }}
        title={(v) => (v.home || v.away ? `${str(v.home) || "?"} – ${str(v.away) || "?"}` : "Nuova partita")}
        create={() => ({ date: todayIso(), time: "", home: cusName, away: "", venue: "", score: "", status: "Da giocare", competition: "Campionato", lineup: { startingFive: [], bench: [], suspended: [], injured: [] } })}
        summary={(v, isNew) => `${isNew ? "Aggiungi" : "Aggiorna"} partita ${cfg.label}: ${str(v.home)} - ${str(v.away)}${v.status === "Terminata" ? ` ${str(v.score)}` : ""}`}
        serialize={(v) => {
          const out = { ...v };
          for (const key of ["scorerEvents", "yellowCardEvents", "redCardEvents", "goalkeeperEvents", "opponentScorerEvents", "opponentLineup"]) {
            if (Array.isArray(out[key]) && !(out[key] as unknown[]).length && !(editing && Array.isArray(editing[key]))) delete out[key];
          }
          return out;
        }}
      >
        {(v, set, replace) => <MatchForm team={team} value={v} set={set} replace={replace} roster={roster.content?.roster || []} opponents={opponents} logos={logos} cusName={cusName} />}
      </ItemEditor>
    </>
  );
}

function MatchForm({ team, value: m, set, replace, roster, opponents, logos, cusName }: {
  team: TeamKey;
  value: Item;
  set: (k: string, v: unknown) => void;
  replace: (v: Item) => void;
  roster: Item[];
  opponents: string[];
  logos: Map<string, string>;
  cusName: string;
}) {
  const cfg = TEAMS[team];
  const [tab, setTab] = React.useState("info");
  const [opponentPicker, setOpponentPicker] = React.useState(false);
  const side = cusSide(m);
  const opponent = opponentName(m);
  const ourName = side === "home" ? str(m.home) : str(m.away);
  const score = scoreParts(m.score);
  const [hs, as] = score ?? [null, null];
  const lineup = (m.lineup && typeof m.lineup === "object" ? m.lineup : {}) as Ev;
  const starting = arr<string>(lineup.startingFive).map(String);
  const bench = arr<string>(lineup.bench).map(String);

  const players: PlayerChoice[] = React.useMemo(
    () =>
      roster
        .filter((p) => p && p.id != null)
        .map((p) => ({ id: String(p.id), name: str(p.name), number: p.number != null ? String(p.number) : undefined, detail: `${str(p.role)} · ${teamLabel(p.team)}`, group: teamLabel(p.team), goalkeeper: p.role === "Portiere" }))
        .sort((a, b) => {
          const own = (g?: string) => (g === cfg.label ? 0 : 1);
          return own(a.group) - own(b.group) || Number(a.number) - Number(b.number);
        }),
    [roster, cfg.label],
  );
  const convocati = starting.length || bench.length ? players.filter((p) => starting.includes(p.id) || bench.includes(p.id)) : players;
  const goalkeepers = convocati.filter((p) => p.goalkeeper);

  const setTeams = (newSide: "home" | "away", opp: string, own = ourName || cusName) => {
    replace({ ...m, home: newSide === "home" ? own : opp, away: newSide === "home" ? opp : own, ...(logos.get(opp.toLowerCase()) && !m.opponentLogo ? { opponentLogo: logos.get(opp.toLowerCase()) } : {}) });
  };
  const setScore = (h: number | null, a: number | null) => set("score", h === null && a === null ? "" : `${h ?? 0}-${a ?? 0}`);
  const setLineup = (key: "startingFive" | "bench", ids: string[]) => {
    const next = { ...lineup, [key]: ids };
    if (key === "startingFive") next.bench = arr<string>(next.bench).filter((id) => !ids.includes(String(id)));
    set("lineup", next);
  };
  const updateList = (key: string, index: number, patch: Ev | null) => {
    const list = [...arr(m[key])];
    if (patch === null) list.splice(index, 1);
    else list[index] = patch;
    set(key, list);
  };

  const cusGoals = arr(m.scorerEvents).reduce((n, e) => n + Math.max(1, Number(e.goals) || 1), 0);
  const ourScore = score ? score[side === "home" ? 0 : 1] : null;

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="mb-5">
        <TabsTrigger value="info">Partita</TabsTrigger>
        <TabsTrigger value="lineup">Formazione <span className="ml-1 opacity-60">{starting.length + bench.length}</span></TabsTrigger>
        <TabsTrigger value="events">Eventi</TabsTrigger>
        {!cfg.youth && <TabsTrigger value="opponents">Avversari</TabsTrigger>}
      </TabsList>

      <TabsContent value="info" className="flex flex-col gap-5">
        <FormSection title="Risultato" description={m.status === "Terminata" ? "Partita conclusa: entra nelle statistiche." : "Imposta “Terminata” quando la partita è finita."}>
          <SegmentedControl value={str(m.status) || "Da giocare"} onChange={(s) => set("status", s)} options={[{ value: "Da giocare", label: "Da giocare" }, { value: "Terminata", label: "Terminata" }]} className="w-full" />
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{str(m.home) || "Casa"}</p></div>
            <span />
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{str(m.away) || "Trasferta"}</p></div>
            <div className="flex justify-center"><Stepper size="lg" label="Gol casa" value={hs} onChange={(x) => setScore(x, as)} /></div>
            <span className="font-display text-3xl text-muted">–</span>
            <div className="flex justify-center"><Stepper size="lg" label="Gol trasferta" value={as} onChange={(x) => setScore(hs, x)} /></div>
          </div>
          {m.status === "Terminata" && ourScore !== null && arr(m.scorerEvents).length > 0 && cusGoals !== ourScore && (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">I marcatori inseriti sommano {cusGoals} gol, il risultato ne indica {ourScore}.</p>
          )}
        </FormSection>

        <FormSection title="Squadre">
          <SegmentedControl value={side} onChange={(s) => setTeams(s, opponent)} options={[{ value: "home", label: "In casa" }, { value: "away", label: "In trasferta" }]} className="w-full" />
          <Field label="Avversario" required>
            <button type="button" onClick={() => setOpponentPicker(true)} className={cn("flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-left", !opponent && "text-muted")}>
              <Shield className="size-4 text-muted" />{opponent || "Scegli o scrivi l'avversario…"}
            </button>
          </Field>
          <TextField label="Nome della nostra squadra" value={ourName} onChange={(x) => setTeams(side, opponent, x)} hint={isCusName(ourName) ? "Deve contenere “CUS Trento” per le statistiche." : undefined} error={!isCusName(ourName) ? "Il nome deve contenere “CUS Trento”, altrimenti la partita non entra nelle statistiche" : undefined} />
          <ImageField label="Logo avversaria" value={m.opponentLogo} onChange={(x) => set("opponentLogo", x)} profile="logo" hint="Mostrato nella fascia prossime partite. Il logo CUS è automatico." />
        </FormSection>

        <FormSection title="Quando e dove">
          <div className="grid grid-cols-2 gap-3">
            <DateField label="Data" required value={m.date} onChange={(x) => set("date", x)} />
            <TimeField label="Ora" value={m.time} onChange={(x) => set("time", x)} />
          </div>
          <TextField label="Campo" value={m.venue} onChange={(x) => set("venue", x)} placeholder="Palazzetto Sanbàpolis" />
          <SelectField label="Competizione" value={m.competition || "Campionato"} onChange={(x) => set("competition", x)} options={COMPETITIONS} />
        </FormSection>
        <SearchPicker
          open={opponentPicker}
          onOpenChange={setOpponentPicker}
          title="Avversario"
          options={opponents.map((o) => ({ value: o, label: o }))}
          value={opponent ? [opponent] : []}
          onChange={(v) => setTeams(side, v[0] ?? "")}
          allowCustom
          customLabel="Nuovo avversario"
        />
      </TabsContent>

      <TabsContent value="lineup" className="flex flex-col gap-5">
        <FormSection title="Quintetto titolare" description={cfg.youth && m.status === "Terminata" ? "Per una partita U23 terminata servono esattamente 5 titolari." : "Fino a 5 giocatori. Il portiere titolare riceve i gol subiti se non indichi altrimenti."}>
          <PlayerMultiPicker label="Titolari" value={starting} onChange={(ids) => setLineup("startingFive", ids)} players={players} max={5} exclude={bench} />
        </FormSection>
        <FormSection title="Panchina / convocati">
          <PlayerMultiPicker label="Panchina" value={bench} onChange={(ids) => setLineup("bench", ids)} players={players} exclude={starting} max={MAX_BENCH} hint={`Al massimo ${MAX_BENCH} giocatori in panchina.`} />
        </FormSection>
      </TabsContent>

      <TabsContent value="events" className="flex flex-col gap-5">
        <FormSection title="Marcatori" description={`Solo giocatori convocati, oppure Autogol (conta nel tabellino, non nella classifica marcatori).${ourScore !== null ? ` Gol inseriti: ${cusGoals}/${ourScore}.` : ""}`}
          action={<Button type="button" size="sm" variant="secondary" onClick={() => set("scorerEvents", [...arr(m.scorerEvents), { playerId: "", goals: 1 }])}><Plus />Gol</Button>}>
          {arr(m.scorerEvents).map((e, i) => (
            <RowCard key={i} onRemove={() => updateList("scorerEvents", i, null)}>
              <div className="flex items-center gap-2">
                <PlayerButton title="Marcatore" value={str(e.playerId)} onChange={(id) => updateList("scorerEvents", i, { ...e, playerId: id })} players={convocati} extraOptions={[{ value: OWN_GOAL_ID, label: "Autogol (avversario)", group: "Speciale" }]} />
                <Stepper label="Reti" min={1} value={Number(e.goals) || 1} onChange={(g) => updateList("scorerEvents", i, { ...e, goals: g })} />
              </div>
              {!cfg.youth && <GoalTimes goals={Number(e.goals) || 1} times={eventTimes(e)} onChange={(t) => updateList("scorerEvents", i, withTimes(e, t))} />}
            </RowCard>
          ))}
        </FormSection>
        {(["yellowCardEvents", "redCardEvents"] as const).map((key) => (
          <FormSection key={key} title={key === "yellowCardEvents" ? "Ammonizioni" : "Espulsioni"} action={<Button type="button" size="sm" variant="secondary" onClick={() => set(key, [...arr(m[key]), { playerId: "", cards: 1 }])}><Plus />Aggiungi</Button>}>
            {arr(m[key]).map((e, i) => (
              <RowCard key={i} onRemove={() => updateList(key, i, null)}>
                <div className="flex items-center gap-2">
                  <span className={cn("h-7 w-5 shrink-0 rounded-sm", key === "yellowCardEvents" ? "bg-yellow-400" : "bg-red-600")} aria-hidden />
                  <PlayerButton title={key === "yellowCardEvents" ? "Ammonito" : "Espulso"} value={str(e.playerId)} onChange={(id) => updateList(key, i, { ...e, playerId: id })} players={convocati} />
                  <Stepper label="Cartellini" min={1} max={2} value={Number(e.cards) || 1} onChange={(c) => updateList(key, i, { ...e, cards: c })} />
                </div>
              </RowCard>
            ))}
          </FormSection>
        ))}
        <FormSection title="Portieri e gol subiti" description="Lascia vuoto per assegnare i gol subiti al portiere titolare." action={<Button type="button" size="sm" variant="secondary" onClick={() => set("goalkeeperEvents", [...arr(m.goalkeeperEvents), { playerId: goalkeepers[0]?.id ?? "", goalsAgainst: 0, appearances: 1 }])}><Plus />Portiere</Button>}>
          {arr(m.goalkeeperEvents).map((e, i) => (
            <RowCard key={i} onRemove={() => updateList("goalkeeperEvents", i, null)}>
              <PlayerButton title="Portiere" value={str(e.playerId)} onChange={(id) => updateList("goalkeeperEvents", i, { ...e, playerId: id })} players={goalkeepers.length ? goalkeepers : convocati} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted">Gol subiti</span>
                <Stepper label="Gol subiti" value={Number(e.goalsAgainst) || 0} onChange={(g) => updateList("goalkeeperEvents", i, { ...e, goalsAgainst: g })} />
              </div>
              <ToggleRow checked={Number(e.appearances ?? 1) > 0} onChange={(on) => updateList("goalkeeperEvents", i, { ...e, appearances: on ? 1 : 0 })} label="Conta come presenza" />
            </RowCard>
          ))}
        </FormSection>
      </TabsContent>

      {!cfg.youth && (
      <TabsContent value="opponents" className="flex flex-col gap-5">
          <FormSection title="Convocati avversari" description="Mostrati nella colonna dei convocati del match center." action={<Button type="button" size="sm" variant="secondary" onClick={() => set("opponentLineup", [...arr(m.opponentLineup), { number: "", surname: "", firstName: "", goals: 0, yellow: false, red: false }])}><Plus />Giocatore</Button>}>
            {arr(m.opponentLineup).map((p, i) => (
              <RowCard key={i} onRemove={() => updateList("opponentLineup", i, null)}>
                <div className="grid grid-cols-[72px_1fr] gap-2">
                  <Input inputMode="numeric" placeholder="N°" value={str(p.number)} onChange={(x) => updateList("opponentLineup", i, { ...p, number: x.target.value.replace(/[^0-9]/g, "") })} aria-label="Numero" />
                  <Input placeholder="Cognome" value={str(p.surname)} onChange={(x) => updateList("opponentLineup", i, { ...p, surname: x.target.value })} aria-label="Cognome" />
                </div>
                <Input placeholder="Nome" value={str(p.firstName)} onChange={(x) => updateList("opponentLineup", i, { ...p, firstName: x.target.value })} aria-label="Nome" />
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted">Reti</span>
                  <Stepper label="Reti" value={Number(p.goals) || 0} onChange={(g) => updateList("opponentLineup", i, { ...p, goals: g })} />
                  <label className="flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"><input type="checkbox" className="size-5 accent-yellow-500" checked={!!p.yellow} onChange={(x) => updateList("opponentLineup", i, { ...p, yellow: x.target.checked })} />Ammonito</label>
                  <label className="flex h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"><input type="checkbox" className="size-5 accent-red-600" checked={!!p.red} onChange={(x) => updateList("opponentLineup", i, { ...p, red: x.target.checked })} />Espulso</label>
                </div>
                {Number(p.goals) > 0 && <GoalTimes goals={Number(p.goals)} times={eventTimes(p)} onChange={(t) => updateList("opponentLineup", i, withTimes(p, t))} />}
              </RowCard>
            ))}
          </FormSection>
      </TabsContent>
      )}
    </Tabs>
  );
}
