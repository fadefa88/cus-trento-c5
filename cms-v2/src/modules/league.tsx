import { CalendarDays, ClipboardPaste, ExternalLink, Plus, Shield, Trophy, Users } from "lucide-react";
import * as React from "react";
import { getAt, valueHash } from "@shared/json";
import { bracket as computeBracket, matchPlayed, OWN_GOAL_NAME, teamKey, type KnockoutResolved, type LeagueData, type LeagueMatch, type LeagueTeam } from "@shared/league";
import { SITE_URL } from "@shared/site";
import { DEFAULT_RULES } from "@shared/league-rules";
import { ErrorBox, FormSection, ItemEditor, SaveBar } from "@/components/editor";
import { DateField, ImageField, StringListField, TextAreaField, TextField, TimeField } from "@/components/fields";
import { RowCard, Stepper } from "@/components/match-ui";
import { ObjectEditor } from "@/components/object-editor";
import { DraftBanner, PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { SearchPicker, Sheet, type PickerOption } from "@/components/ui/dialogs";
import { Badge, Card, EmptyState, Field, Input, SegmentedControl, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui/primitives";
import { useDocument, useSave, type SaveMode } from "@/lib/docs";
import { setQuery, useRoute } from "@/lib/router";
import { cn, formatDate, imageUrl } from "@/lib/utils";

type Item = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");
const LIST_TEAMS = ["cusTrentoLeague", "teams"];
const LIST_MATCHES = ["cusTrentoLeague", "matches"];

function initials(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return w.length === 1 ? w[0].slice(0, 3).toUpperCase() : (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

function TeamBadge({ league, name, size = "md" }: { league: LeagueData; name: string; size?: "sm" | "md" | "lg" }) {
  const team = (league.teams || []).find((t) => teamKey(t.name) === teamKey(name));
  const dim = size === "sm" ? "size-7 text-[10px]" : size === "lg" ? "size-14 text-base" : "size-9 text-xs";
  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface-2 font-bold text-muted", dim)}>
      {team?.logo ? <img src={imageUrl(team.logo)} alt="" className="size-full bg-white object-contain p-0.5" /> : initials(name)}
    </span>
  );
}

export function LeaguePage() {
  const route = useRoute();
  const { content, isLoading, hasDraft, error, refetch } = useDocument("events");
  const league = ((content?.cusTrentoLeague as LeagueData) || { teams: [], matches: [] }) as LeagueData;
  const tab = route.query.get("tab") || "partite";
  return (
    <>
      <PageHeader
        title={str(league.title) || "CUS Trento League"}
        eyebrow={str(league.edition) || "Torneo"}
        actions={<a href={`${SITE_URL}/cus-trento-league/`} target="_blank" rel="noreferrer"><Button variant="outline" size="icon" aria-label="Apri la pagina del torneo"><ExternalLink /></Button></a>}
      />
      <DraftBanner doc="events" />
      {error && <ErrorBox error={error} onReload={() => refetch()} />}
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <Tabs value={tab} onValueChange={(t) => setQuery({ tab: t, edit: null }, { replace: true })}>
          <TabsList className="mb-5">
            <TabsTrigger value="partite">Partite</TabsTrigger>
            <TabsTrigger value="tabellone">Fasi finali</TabsTrigger>
            <TabsTrigger value="squadre">Squadre</TabsTrigger>
            <TabsTrigger value="regolamento">Regolamento</TabsTrigger>
            <TabsTrigger value="info">Info</TabsTrigger>
          </TabsList>
          <TabsContent value="partite"><MatchesTab league={league} hasDraft={hasDraft} /></TabsContent>
          <TabsContent value="tabellone"><BracketTab league={league} source={content} hasDraft={hasDraft} /></TabsContent>
          <TabsContent value="squadre"><TeamsTab league={league} hasDraft={hasDraft} /></TabsContent>
          <TabsContent value="regolamento"><RulesTab source={content} hasDraft={hasDraft} /></TabsContent>
          <TabsContent value="info"><InfoTab source={content} hasDraft={hasDraft} /></TabsContent>
        </Tabs>
      )}
    </>
  );
}

// ---- Matches --------------------------------------------------------------------
function MatchesTab({ league, hasDraft }: { league: LeagueData; hasDraft: boolean }) {
  const route = useRoute();
  const [group, setGroup] = React.useState<"all" | "A" | "B">("all");
  const matches = (league.matches || []) as Array<LeagueMatch & Item>;
  const visible = matches.filter((m) => group === "all" || m.group === group);
  const rounds = [...new Set(visible.map((m) => str(m.round) || "Senza giornata"))];
  const editId = route.query.get("edit");
  const editing = editId && editId !== "new" ? matches.find((m) => str(m.id) === editId) || null : null;
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <SegmentedControl value={group} onChange={setGroup} options={[{ value: "all", label: "Tutti" }, { value: "A", label: "Girone A" }, { value: "B", label: "Girone B" }]} />
        <Button onClick={() => setQuery({ edit: "new" })} aria-label="Nuova partita"><Plus /><span className="hidden sm:inline">Nuova partita</span></Button>
      </div>
      {!matches.length ? (
        <EmptyState icon={CalendarDays} title="Nessuna partita in calendario" text="Aggiungi le partite dei gironi: classifiche e tabellone si aggiornano da soli." />
      ) : (
        <div className="flex flex-col gap-6">
          {rounds.map((round) => (
            <section key={round}>
              <h3 className="mb-2 font-display text-xl font-bold">{round}</h3>
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {visible.filter((m) => (str(m.round) || "Senza giornata") === round).sort((a, b) => `${str(a.date)}${str(a.time)}`.localeCompare(`${str(b.date)}${str(b.time)}`)).map((m) => (
                  <li key={str(m.id)}>
                    <Card>
                      <button type="button" className="w-full p-4 text-left" onClick={() => setQuery({ edit: str(m.id) })}>
                        <div className="mb-3 flex items-center justify-between text-xs text-muted">
                          <span>Girone {str(m.group) || "–"} · {formatDate(m.date, true)} {str(m.time)}</span>
                          {matchPlayed(m) ? <Badge tone="success">Terminata</Badge> : <Badge>Da giocare</Badge>}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {([[m.home, m.homeScore], [m.away, m.awayScore]] as const).map(([team, score]) => (
                            <div key={team} className="flex items-center gap-2.5">
                              <TeamBadge league={league} name={team} />
                              <b className="min-w-0 flex-1 truncate text-[15px]">{team}</b>
                              <span className="font-display text-2xl font-bold tabular">{matchPlayed(m) ? score : ""}</span>
                            </div>
                          ))}
                        </div>
                        {(m.scorers || []).length > 0 && <p className="mt-2 truncate text-xs text-muted">⚽ {(m.scorers || []).map((s) => `${s.name}${Number(s.goals) > 1 ? ` ×${s.goals}` : ""}`).join(", ")}</p>}
                      </button>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ItemEditor<Item>
        doc="events"
        list={LIST_MATCHES}
        item={editing}
        open={!!editId && (editId === "new" || !!editing)}
        onClose={() => setQuery({ edit: null }, { force: true })}
        hasDraft={hasDraft}
        wide
        title={(v) => (v.home || v.away ? `${str(v.home) || "?"} – ${str(v.away) || "?"}` : "Nuova partita League")}
        create={() => ({ date: "", time: "", group: group === "all" ? "A" : group, round: matches.length ? str(matches[matches.length - 1].round) : "1ª giornata", home: "", away: "", homeScore: null, awayScore: null, status: "Da giocare", scorers: [] })}
        summary={(v, isNew) => `League: ${isNew ? "aggiungi" : "aggiorna"} ${str(v.home)} - ${str(v.away)}${matchPlayed(v as never) ? ` ${v.homeScore}-${v.awayScore}` : ""}`}
        serialize={(v) => ({ ...v, status: matchPlayed(v as never) ? "Terminata" : v.status === "Terminata" ? "Terminata" : "Da giocare", scorers: ((v.scorers as Item[]) || []).filter((s) => str(s.name).trim()) })}
      >
        {(v, set, replace) => <LeagueMatchForm league={league} value={v} set={set} replace={replace} />}
      </ItemEditor>
    </>
  );
}

function TeamPickerButton({ league, value, onChange, title, group }: { league: LeagueData; value: string; onChange: (v: string) => void; title: string; group?: string }) {
  const [open, setOpen] = React.useState(false);
  const options: PickerOption[] = (league.teams || []).map((t) => ({ value: t.name, label: t.name, group: `Girone ${t.group}`, description: `${(t.players || []).length} giocatori` }))
    .sort((a, b) => (a.group === `Girone ${group}` ? -1 : 0) - (b.group === `Girone ${group}` ? -1 : 0) || a.group!.localeCompare(b.group!) || a.label.localeCompare(b.label));
  return (
    <Field label={title} required>
      <button type="button" onClick={() => setOpen(true)} className="flex h-12 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-left">
        {value ? <><TeamBadge league={league} name={value} size="sm" /><b className="truncate">{value}</b></> : <span className="flex items-center gap-2 text-muted"><Shield className="size-4" />Scegli squadra…</span>}
      </button>
      <SearchPicker open={open} onOpenChange={setOpen} title={title} options={options} value={value ? [value] : []} onChange={(v) => onChange(v[0] ?? "")} />
    </Field>
  );
}

/**
 * Scorers of a game, grouped by team. The picker offers the team's roster and
 * the own goal ("Autogol", shown in the report but not in the scorers ranking);
 * a name outside the roster can be typed as an exception.
 */
function ScorersByTeam({ league, teams, scores, scorers: input, onChange }: { league: LeagueData; teams: [string, string]; scores: [number | null | undefined, number | null | undefined]; scorers: Item[]; onChange: (list: Item[]) => void }) {
  const scorers = (input || []).map((s) => ({ ...s }));
  const [picker, setPicker] = React.useState<null | string>(null);
  const known = (name: string) => (league.teams || []).some((t) => teamKey(t.name) === teamKey(name));
  const goalsOf = (team: string) => scorers.filter((s) => teamKey(s.team) === teamKey(team)).reduce((n, s) => n + Math.max(1, Number(s.goals) || 1), 0);
  const add = (team: string, name: string) => {
    const existing = scorers.findIndex((s) => teamKey(s.team) === teamKey(team) && teamKey(s.name) === teamKey(name));
    if (existing >= 0) {
      scorers[existing].goals = Math.max(1, Number(scorers[existing].goals) || 1) + 1;
      onChange(scorers);
    } else onChange([...scorers, { name, team, goals: 1 }]);
  };
  const options = (team: string): PickerOption[] => {
    const t = (league.teams || []).find((x) => teamKey(x.name) === teamKey(team));
    const other = team === teams[0] ? teams[1] : teams[0];
    return [
      { value: OWN_GOAL_NAME, label: "Autogol", description: `Autorete di ${other || "avversari"} a favore di ${team}`, group: "Speciale" },
      ...(t?.players || []).map((p) => (typeof p === "string" ? { name: p } : p)).map((p) => ({ value: p.name, label: p.name, badge: p.number != null && p.number !== "" ? String(p.number) : undefined, group: `Rosa ${team}` })),
    ];
  };
  return (
    <>
      {teams.map((team, side) => {
        if (!team || !known(team)) return null;
        const score = scores[side] ?? null;
        const g = goalsOf(team);
        return (
          <FormSection key={team} title={`Marcatori ${team}`} description={score != null ? `${g} su ${score} gol attribuiti` : undefined} action={<Button type="button" size="sm" variant="secondary" onClick={() => setPicker(team)}><Plus />Gol</Button>}>
            {score != null && g > score && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">I marcatori superano i gol segnati.</p>}
            {scorers.map((s, i) => teamKey(s.team) !== teamKey(team) ? null : (
              <RowCard key={i} onRemove={() => onChange(scorers.filter((_, j) => j !== i))}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{str(s.name)}{str(s.name) === OWN_GOAL_NAME && <Badge className="ml-2" tone="warning">non in classifica marcatori</Badge>}</span>
                  <Stepper label="Reti" min={1} value={Number(s.goals) || 1} onChange={(x) => { scorers[i].goals = x; onChange(scorers); }} />
                </div>
              </RowCard>
            ))}
            <SearchPicker open={picker === team} onOpenChange={(o) => !o && setPicker(null)} title={`Gol di ${team}`} options={options(team)} value={[]} onChange={(v) => v[0] && add(team, v[0])} allowCustom customLabel="Aggiungi fuori rosa:" emptyText="Rosa vuota: scrivi il nome per aggiungerlo come eccezione" />
          </FormSection>
        );
      })}
    </>
  );
}

function LeagueMatchForm({ league, value: m, set, replace }: { league: LeagueData; value: Item; set: (k: string, v: unknown) => void; replace: (v: Item) => void }) {
  const home = str(m.home), away = str(m.away);
  const scorers = (m.scorers as Item[]) || [];
  const swapSelect = (side: "home" | "away", name: string) => {
    const t = (league.teams || []).find((x) => teamKey(x.name) === teamKey(name));
    const old = side === "home" ? home : away;
    // Scorers of the replaced team no longer belong to this match.
    replace({ ...m, [side]: name, group: m.group || t?.group || "A", scorers: scorers.filter((s) => teamKey(s.team) !== teamKey(old)) });
  };
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Squadre">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TeamPickerButton league={league} title="Casa" value={home} onChange={(v) => swapSelect("home", v)} group={str(m.group)} />
          <TeamPickerButton league={league} title="Trasferta" value={away} onChange={(v) => swapSelect("away", v)} group={str(m.group)} />
        </div>
        <SegmentedControl value={str(m.group) || "A"} onChange={(g) => set("group", g)} options={[{ value: "A", label: "Girone A" }, { value: "B", label: "Girone B" }]} className="w-full" />
      </FormSection>
      <FormSection title="Risultato" description="Con entrambi i punteggi la partita diventa “Terminata” ed entra in classifica.">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
          <p className="truncate text-sm font-semibold">{home || "Casa"}</p><span /><p className="truncate text-sm font-semibold">{away || "Trasferta"}</p>
          <div className="flex justify-center"><Stepper size="lg" label="Gol casa" value={m.homeScore as number | null} onChange={(x) => set("homeScore", x)} /></div>
          <span className="font-display text-3xl text-muted">–</span>
          <div className="flex justify-center"><Stepper size="lg" label="Gol trasferta" value={m.awayScore as number | null} onChange={(x) => set("awayScore", x)} /></div>
        </div>
        {matchPlayed(m as never) && <Button type="button" variant="ghost" size="sm" className="self-center" onClick={() => replace({ ...m, homeScore: null, awayScore: null, status: "Da giocare" })}>Azzera risultato</Button>}
      </FormSection>
      <ScorersByTeam league={league} teams={[home, away]} scores={[m.homeScore as number | null, m.awayScore as number | null]} scorers={scorers} onChange={(list) => set("scorers", list)} />
      <FormSection title="Programma">
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Data" value={m.date} onChange={(x) => set("date", x)} />
          <TimeField label="Ora" value={m.time} onChange={(x) => set("time", x)} />
        </div>
        <TextField label="Giornata" value={m.round} onChange={(x) => set("round", x)} placeholder="1ª giornata" />
      </FormSection>
    </div>
  );
}

// ---- Bracket ----------------------------------------------------------------------
type KoRef = { path: string[]; name: string; resolved: KnockoutResolved & { seeds: [string, string] } };

function BracketTab({ league, source, hasDraft }: { league: LeagueData; source: Item | undefined; hasDraft: boolean }) {
  const b = computeBracket(league);
  const [editing, setEditing] = React.useState<KoRef | null>(null);
  const base = ["cusTrentoLeague", "bracket"];
  const rounds: Array<{ title: string; items: KoRef[] }> = [
    { title: "Quarti di finale", items: b.quarters.map((q, i) => ({ path: [...base, "quarterfinals", String(i)], name: `Quarto ${i + 1}`, resolved: q })) },
    { title: "Semifinali", items: b.semis.map((q, i) => ({ path: [...base, "semifinals", String(i)], name: `Semifinale ${i + 1}`, resolved: q })) },
    { title: "Finale", items: [{ path: [...base, "final"], name: "Finale", resolved: b.final }] },
  ];
  return (
    <>
      <p className="mb-4 text-sm text-muted">Accoppiamenti automatici dalle classifiche: 1ªA–4ªB, 2ªA–3ªB, 3ªA–2ªB, 4ªA–1ªB. Vincenti Q1/Q2 e Q3/Q4 in semifinale. Gara unica, eliminazione diretta.</p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {rounds.map((r) => (
          <section key={r.title} className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-bold">{r.title}</h3>
            {r.items.map((ko) => (
              <Card key={ko.name} className={cn(ko.resolved.needsManualWinner && "border-warning", ko.resolved.invalidManualWinner && "border-danger")}>
                <button type="button" className="w-full p-3 text-left" onClick={() => setEditing(ko)}>
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted"><span className="font-semibold uppercase">{ko.name}</span><span className="text-right">{[ko.resolved.date ? formatDate(ko.resolved.date, true) : "", ko.resolved.time].filter(Boolean).join(" · ") || "Da programmare"}</span></div>
                  {([0, 1] as const).map((side) => {
                    const team = side === 0 ? ko.resolved.team1 : ko.resolved.team2;
                    const score = side === 0 ? ko.resolved.team1Score : ko.resolved.team2Score;
                    const winner = !!ko.resolved.winner && teamKey(ko.resolved.winner) === teamKey(team);
                    return (
                      <div key={side} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5", winner && "bg-success-soft")}>
                        <span className="w-9 text-[11px] font-bold text-muted">{ko.resolved.seeds[side]}</span>
                        <TeamBadge league={league} name={team} size="sm" />
                        <span className={cn("min-w-0 flex-1 truncate", winner ? "font-bold" : "")}>{team}</span>
                        <span className="font-display text-xl font-bold tabular">{score ?? "–"}</span>
                      </div>
                    );
                  })}
                  {ko.resolved.scorers.length > 0 && <p className="mt-2 truncate text-xs text-muted">⚽ {ko.resolved.scorers.map((sc) => `${sc.name}${Number(sc.goals) > 1 ? ` ×${sc.goals}` : ""}`).join(", ")}</p>}
                  {ko.resolved.needsManualWinner && <p className="mt-2 text-xs font-semibold text-warning">Pareggio: indica la qualificata</p>}
                  {ko.resolved.invalidManualWinner && <p className="mt-2 text-xs font-semibold text-danger">Vincente indicata non valida</p>}
                </button>
              </Card>
            ))}
          </section>
        ))}
      </div>
      <Card className="mt-5 flex items-center gap-3 p-4">
        <Trophy className="size-8 text-warning" />
        <div><p className="text-xs uppercase text-muted">Campione CUS Trento League</p><p className="font-display text-2xl font-bold">{b.champion || "Da definire"}</p></div>
      </Card>
      <KnockoutEditor ko={editing} league={league} source={source} onClose={() => setEditing(null)} hasDraft={hasDraft} />
    </>
  );
}

function KnockoutEditor({ ko, league, source, onClose, hasDraft }: { ko: KoRef | null; league: LeagueData; source: Item | undefined; onClose: () => void; hasDraft: boolean }) {
  const [state, setState] = React.useState<Item>({});
  const [original, setOriginal] = React.useState<unknown>(null);
  const [saving, setSaving] = React.useState<SaveMode | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const save = useSave("events");
  React.useEffect(() => {
    if (!ko || !source) return;
    const stored = getAt(source, ko.path) as Item | undefined;
    setOriginal(stored ?? null);
    setState({ ...(stored || { name: ko.name }) });
    setError(null);
  }, [ko, source]);
  if (!ko) return null;
  const t1 = ko.resolved.team1, t2 = ko.resolved.team2;
  const s1 = state.team1Score as number | null | undefined, s2 = state.team2Score as number | null | undefined;
  const tie = s1 != null && s2 != null && s1 === s2;
  const dirty = JSON.stringify(state) !== JSON.stringify(original ?? { name: ko.name });
  const submit = async (mode: SaveMode) => {
    setSaving(mode);
    setError(null);
    try {
      const scorers = ((state.scorers as Item[]) || []).filter((sc) => str(sc.name).trim() && (teamKey(sc.team) === teamKey(t1) || teamKey(sc.team) === teamKey(t2)));
      const value = { ...state, name: state.name || ko.name, team1Score: s1 ?? null, team2Score: s2 ?? null, winner: tie ? str(state.winner) : "", scorers };
      await save.mutateAsync({ ops: [{ type: "set", path: ko.path, base: await valueHash(original ?? null), value }], mode, summary: `League: ${ko.name} ${t1} - ${t2}` });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(null);
    }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={ko.name} subtitle="Gara unica a eliminazione diretta" footer={<SaveBar onSave={submit} saving={saving} dirty={dirty} hasDraft={hasDraft} />}>
      <ErrorBox error={error} />
      <div className="flex flex-col gap-5">
        <FormSection title="Risultato">
          {([[t1, "team1Score", ko.resolved.seeds[0]], [t2, "team2Score", ko.resolved.seeds[1]]] as const).map(([team, key, seed]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="min-w-0"><span className="block text-xs font-bold text-muted">{seed}</span><b className="block truncate">{team}</b></span>
              <Stepper size="lg" label={`Gol ${team}`} value={state[key] as number | null} onChange={(x) => setState((p) => ({ ...p, [key]: x }))} />
            </div>
          ))}
          {(s1 != null || s2 != null) && <Button variant="ghost" size="sm" className="self-center" onClick={() => setState((p) => ({ ...p, team1Score: null, team2Score: null, winner: "" }))}>Azzera risultato</Button>}
        </FormSection>
        {tie && (
          <FormSection title="Qualificata" description="In caso di parità indica la squadra che passa il turno, secondo le disposizioni dell'organizzazione.">
            <SegmentedControl value={str(state.winner)} onChange={(w) => setState((p) => ({ ...p, winner: w }))} options={[{ value: t1, label: t1 }, { value: t2, label: t2 }]} className="w-full" />
          </FormSection>
        )}
        <ScorersByTeam league={league} teams={[t1, t2]} scores={[s1, s2]} scorers={(state.scorers as Item[]) || []} onChange={(list) => setState((p) => ({ ...p, scorers: list }))} />
        <FormSection title="Programma" description="Data e ora della gara, come nel calendario dei gironi. Puoi impostarle anche prima di conoscere le squadre.">
          <div className="grid grid-cols-2 gap-3">
            <DateField label="Data" value={state.date} onChange={(date) => setState((p) => ({ ...p, date }))} />
            <TimeField label="Ora" value={state.time} onChange={(time) => setState((p) => ({ ...p, time }))} />
          </div>
        </FormSection>
        {/^(Da definire|Vincente )/.test(t1) || /^(Da definire|Vincente )/.test(t2) ? <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">Le squadre di questo incontro non sono ancora definite: puoi comunque registrare il risultato, ma verifica gli accoppiamenti.</p> : null}
      </div>
    </Sheet>
  );
}

// ---- Teams --------------------------------------------------------------------------
function TeamsTab({ league, hasDraft }: { league: LeagueData; hasDraft: boolean }) {
  const route = useRoute();
  const teams = (league.teams || []) as Array<LeagueTeam & Item>;
  const editId = route.query.get("edit");
  const editing = editId && editId !== "new" ? teams.find((t) => str(t.id) === editId) || null : null;
  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setQuery({ edit: "new" })}><Plus />Nuova squadra</Button></div>
      {!teams.length ? <EmptyState icon={Users} title="Nessuna squadra" /> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {(["A", "B"] as const).map((g) => (
            <section key={g}>
              <h3 className="mb-2 font-display text-xl font-bold">Girone {g}</h3>
              <ul className="flex flex-col gap-2">
                {teams.filter((t) => t.group === g).map((t) => (
                  <li key={str(t.id)}>
                    <Card>
                      <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setQuery({ edit: str(t.id) })}>
                        <TeamBadge league={league} name={t.name} size="lg" />
                        <span className="min-w-0 flex-1"><b className="block truncate text-lg">{t.name}</b><span className="text-sm text-muted">{(t.players || []).length} giocatori</span></span>
                      </button>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ItemEditor<Item>
        doc="events"
        list={LIST_TEAMS}
        item={editing}
        open={!!editId && (editId === "new" || !!editing)}
        onClose={() => setQuery({ edit: null }, { force: true })}
        hasDraft={hasDraft}
        title={(v) => str(v.name) || "Nuova squadra"}
        create={() => ({ name: "", group: "A", logo: "", players: [] })}
        summary={(v, isNew) => `League: ${isNew ? "aggiungi" : "aggiorna"} squadra ${str(v.name)}`}
        serialize={(v) => ({ ...v, players: ((v.players as Item[]) || []).filter((p) => str(p.name).trim()) })}
        deleteLabel="Elimina squadra"
      >
        {(v, set) => <TeamForm value={v} set={set} />}
      </ItemEditor>
    </>
  );
}

function TeamForm({ value: t, set }: { value: Item; set: (k: string, v: unknown) => void }) {
  const players: Item[] = ((t.players as Array<Item | string>) || []).map((p) => (typeof p === "string" ? { name: p } : { ...p }));
  const [paste, setPaste] = React.useState<string | null>(null);
  const update = (i: number, patch: Item | null) => {
    const next = [...players];
    if (patch === null) next.splice(i, 1);
    else next[i] = patch;
    set("players", next);
  };
  const importList = () => {
    const parsed = (paste || "").split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const m = line.match(/^#?(\d{1,3})[\s.)-]+(.+)$/);
      return m ? { number: m[1], name: m[2].trim() } : { number: "", name: line };
    });
    set("players", [...players, ...parsed]);
    setPaste(null);
  };
  return (
    <>
      <ImageField label="Logo" value={t.logo} onChange={(x) => set("logo", x)} profile="logo" />
      <TextField label="Nome squadra" required value={t.name} onChange={(x) => set("name", x)} hint="Rinominando la squadra, partite, marcatori e tabellone vengono aggiornati automaticamente." />
      <SegmentedControl value={str(t.group) || "A"} onChange={(g) => set("group", g)} options={[{ value: "A", label: "Girone A" }, { value: "B", label: "Girone B" }]} className="w-full" />
      <FormSection title={`Rosa (${players.length})`} action={<Button type="button" size="sm" variant="ghost" onClick={() => setPaste("")}><ClipboardPaste />Incolla elenco</Button>}>
        {paste !== null && (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
            <Textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Un giocatore per riga, es.\n7 Rossi M.\n10 Bianchi L."} />
            <div className="flex gap-2"><Button size="sm" onClick={importList}>Aggiungi alla rosa</Button><Button size="sm" variant="ghost" onClick={() => setPaste(null)}>Annulla</Button></div>
          </div>
        )}
        {players.map((p, i) => (
          <div key={i} className="grid grid-cols-[64px_1fr_auto] items-center gap-2">
            <Input inputMode="numeric" placeholder="N°" value={str(p.number)} onChange={(e) => update(i, { ...p, number: e.target.value.replace(/[^0-9]/g, "") })} aria-label="Numero" />
            <Input placeholder="Cognome N." value={str(p.name)} onChange={(e) => update(i, { ...p, name: e.target.value })} aria-label="Nome" />
            <Button type="button" variant="ghost" size="icon-sm" className="text-danger" onClick={() => update(i, null)} aria-label="Rimuovi">✕</Button>
          </div>
        ))}
        <Button type="button" variant="outline" className="self-start" onClick={() => set("players", [...players, { number: "", name: "" }])}><Plus />Giocatore</Button>
      </FormSection>
    </>
  );
}

// ---- Rules and info ------------------------------------------------------------------

function RulesTab({ source, hasDraft }: { source: Item | undefined; hasDraft: boolean }) {
  const league = (source?.cusTrentoLeague || {}) as Item;
  const custom = league.rules && typeof league.rules === "object";
  return (
    <>
      {!custom && <p className="mb-4 rounded-2xl bg-surface-2 p-4 text-sm text-muted">Il sito mostra ancora il testo predefinito del regolamento. Qui sotto trovi lo stesso testo: modificalo e pubblicalo per sostituirlo. Usa **testo** per il grassetto e [testo](https://indirizzo) per i link.</p>}
      <ObjectEditor<{ rules: typeof DEFAULT_RULES }> doc="events" path={["cusTrentoLeague"]} source={source} keys={["rules"]} hasDraft={hasDraft} summary="League: aggiorna regolamento">
        {(v, set) => {
          const rules = (v.rules && typeof v.rules === "object" ? v.rules : DEFAULT_RULES) as typeof DEFAULT_RULES;
          const update = (patch: Partial<typeof DEFAULT_RULES>) => set("rules", { ...rules, ...patch });
          return (
            <>
              <TextField label="Titolo" value={rules.heading} onChange={(x) => update({ heading: x })} />
              <TextAreaField label="Introduzione" value={rules.intro} onChange={(x) => update({ intro: x })} rows={3} />
              {rules.sections.map((s, i) => (
                <RowCard key={i} onRemove={() => update({ sections: rules.sections.filter((_, j) => j !== i) })}>
                  <TextField label={`Sezione ${i + 1}`} value={s.title} onChange={(x) => update({ sections: rules.sections.map((y, j) => (j === i ? { ...y, title: x } : y)) })} />
                  <StringListField label="Paragrafi" multiline value={s.paragraphs} onChange={(x) => update({ sections: rules.sections.map((y, j) => (j === i ? { ...y, paragraphs: x } : y)) })} addLabel="Paragrafo" />
                </RowCard>
              ))}
              <Button type="button" variant="outline" className="self-start" onClick={() => update({ sections: [...rules.sections, { title: `${rules.sections.length + 1}. Nuova sezione`, paragraphs: [""] }] })}><Plus />Sezione</Button>
            </>
          );
        }}
      </ObjectEditor>
    </>
  );
}

function InfoTab({ source, hasDraft }: { source: Item | undefined; hasDraft: boolean }) {
  type Info = { title: string; edition: string; sport: string; startDate: string; endDate: string; venue: string; instagram: string };
  return (
    <ObjectEditor<Info> doc="events" path={["cusTrentoLeague"]} source={source} keys={["title", "edition", "sport", "startDate", "endDate", "venue", "instagram"]} hasDraft={hasDraft} summary="League: aggiorna informazioni">
      {(v, set) => (
        <>
          <TextField label="Titolo" value={v.title} onChange={(x) => set("title", x)} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Edizione" value={v.edition} onChange={(x) => set("edition", x)} />
            <TextField label="Sport" value={v.sport} onChange={(x) => set("sport", x)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DateField label="Data inizio" value={v.startDate} onChange={(x) => set("startDate", x)} />
            <DateField label="Data fine" value={v.endDate} onChange={(x) => set("endDate", x)} />
          </div>
          <TextField label="Campo" value={v.venue} onChange={(x) => set("venue", x)} />
          <TextField label="Instagram" type="url" inputMode="url" value={v.instagram} onChange={(x) => set("instagram", x.trim())} placeholder="https://www.instagram.com/…" />
        </>
      )}
    </ObjectEditor>
  );
}
