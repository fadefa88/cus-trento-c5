// Business rules checked on the items an operation touched. Data already in
// the repository is never rejected for problems it had before: only what the
// editor changed must be valid (errors); everything else is a warning.
import { COMPETITIONS, MATCH_STATUSES, OWN_GOAL_ID, ROSTER_ROLES, ROSTER_TEAMS, type DocumentId } from "./documents";
import { getAt, isObject } from "./json";
import { bracket, isOwnGoal, matchPlayed, teamKey, type LeagueData } from "./league";
import type { Touched } from "./ops";
import { richDocSchema } from "./richtext";
import { HTML_TAG, ISO_DATE, TIME } from "./schemas";

export interface RuleIssue { path: string; message: string }
export interface RuleResult { errors: RuleIssue[]; warnings: RuleIssue[] }
export interface RuleContext {
  roster?: Array<Record<string, unknown>>;
  /** Matches of both teams, to protect players referenced by match events. */
  matches?: Array<Record<string, unknown>>;
}

function playerReferences(matches: Array<Record<string, unknown>>, id: string): number {
  let n = 0;
  for (const m of matches) {
    const l = isObject(m.lineup) ? m.lineup : {};
    const ids = [
      ...(Array.isArray(l.startingFive) ? l.startingFive : []),
      ...(Array.isArray(l.bench) ? l.bench : []),
      ...["scorerEvents", "yellowCardEvents", "redCardEvents", "goalkeeperEvents"].flatMap((k) => (Array.isArray(m[k]) ? (m[k] as Item[]).map((e) => e?.playerId) : [])),
    ].map(String);
    if (ids.includes(id)) n++;
  }
  return n;
}

type Item = Record<string, unknown>;

/** Produced by the server from contentDoc, whose text nodes are checked like any other text. */
const MARKUP_EXEMPT = new Set(["bodyHtml"]);

function findMarkup(value: unknown, path: string, out: RuleIssue[]) {
  if (typeof value === "string") {
    if (HTML_TAG.test(value)) out.push({ path, message: "Il testo non può contenere tag HTML" });
  } else if (Array.isArray(value)) value.forEach((v, i) => findMarkup(v, `${path}.${i}`, out));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) if (!MARKUP_EXEMPT.has(k)) findMarkup(v, `${path}.${k}`, out);
}

export const scoreParts = (score: unknown): [number, number] | null => {
  const parts = String(score || "").match(/\d+/g);
  return parts && parts.length >= 2 ? [parseInt(parts[0], 10), parseInt(parts[1], 10)] : null;
};
export const isCusName = (name: unknown) => {
  const t = String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  return t.includes("custrento") || t === "cus";
};

function checkMatch(doc: DocumentId, m: Item, p: string, ctx: RuleContext, r: RuleResult) {
  const err = (path: string, message: string) => r.errors.push({ path: `${p}.${path}`, message });
  const warn = (path: string, message: string) => r.warnings.push({ path: `${p}.${path}`, message });
  if (!ISO_DATE.test(String(m.date || ""))) err("date", "Data obbligatoria");
  if (m.time && !TIME.test(String(m.time))) warn("time", "Formato ora consigliato HH:MM");
  if (!String(m.home || "").trim()) err("home", "Squadra di casa obbligatoria");
  if (!String(m.away || "").trim()) err("away", "Squadra in trasferta obbligatoria");
  if (m.status && !(MATCH_STATUSES as readonly string[]).includes(String(m.status))) err("status", "Stato non valido");
  if (m.competition && !(COMPETITIONS as readonly string[]).includes(String(m.competition))) err("competition", "Competizione non valida");
  if (!isCusName(m.home) && !isCusName(m.away)) warn("home", "Nessuna squadra contiene \"CUS Trento\": la partita non entrerà nelle statistiche");

  const terminated = String(m.status) === "Terminata";
  const score = scoreParts(m.score);
  if (terminated && !score) err("score", "Per una partita terminata indica il risultato (es. 4-2)");

  const lineup = isObject(m.lineup) ? m.lineup : {};
  const starting = (Array.isArray(lineup.startingFive) ? lineup.startingFive : []).map(String);
  const bench = (Array.isArray(lineup.bench) ? lineup.bench : []).map(String);
  if (starting.length > 5) err("lineup.startingFive", "Il quintetto titolare ha al massimo 5 giocatori");
  if (new Set(starting).size !== starting.length) err("lineup.startingFive", "Giocatore duplicato nel quintetto");
  if (new Set(bench).size !== bench.length) err("lineup.bench", "Giocatore duplicato in panchina");
  if (bench.some((id) => starting.includes(id))) err("lineup.bench", "Un giocatore non può essere sia titolare sia in panchina");
  if (doc === "u21Fixtures" && terminated && starting.length !== 5) err("lineup.startingFive", "Per una partita U23 terminata servono esattamente 5 titolari");
  if (doc === "fixtures" && terminated && starting.length && starting.length !== 5) warn("lineup.startingFive", "Il quintetto titolare non ha 5 giocatori");

  const roster = ctx.roster;
  const known = roster ? new Set(roster.map((x) => String(x.id))) : null;
  const inLineup = new Set([...starting, ...bench]);
  if (known) for (const id of inLineup) if (!known.has(id)) err("lineup", `Giocatore sconosciuto: ${id}`);

  const events: Array<[string, string]> = [["scorerEvents", "Marcatori"], ["yellowCardEvents", "Ammonizioni"], ["redCardEvents", "Espulsioni"], ["goalkeeperEvents", "Portieri"]];
  let cusGoals = 0;
  for (const [key, label] of events) {
    const list = Array.isArray(m[key]) ? (m[key] as Item[]) : [];
    list.forEach((ev, i) => {
      const pid = String(ev?.playerId ?? "");
      if (!pid) return err(`${key}.${i}`, `${label}: seleziona un giocatore`);
      if (key === "scorerEvents") cusGoals += Math.max(1, Number(ev.goals) || 1);
      if (key === "scorerEvents" && pid === OWN_GOAL_ID) return;
      if (known && !known.has(pid)) return err(`${key}.${i}`, `${label}: giocatore sconosciuto (${pid})`);
      if (inLineup.size && !inLineup.has(pid)) err(`${key}.${i}`, `${label}: il giocatore non è tra titolari o panchina`);
      if (key === "goalkeeperEvents" && roster) {
        const player = roster.find((x) => String(x.id) === pid);
        if (player && player.role !== "Portiere") warn(`${key}.${i}`, "Il giocatore non è registrato come portiere");
      }
    });
  }
  if (terminated && score) {
    const cus = isCusName(m.home) ? score[0] : isCusName(m.away) ? score[1] : null;
    const scorers = Array.isArray(m.scorerEvents) ? m.scorerEvents : [];
    if (cus !== null && scorers.length && cusGoals !== cus) warn("scorerEvents", `I gol dei marcatori (${cusGoals}) non corrispondono al risultato (${cus})`);
  }
}

function checkLeagueMatch(league: LeagueData, m: Item, p: string, r: RuleResult) {
  const err = (path: string, message: string) => r.errors.push({ path: `${p}.${path}`, message });
  const warn = (path: string, message: string) => r.warnings.push({ path: `${p}.${path}`, message });
  const teams = league.teams || [];
  const home = teams.find((t) => teamKey(t.name) === teamKey(m.home));
  const away = teams.find((t) => teamKey(t.name) === teamKey(m.away));
  if (!home) err("home", "Seleziona una squadra di casa esistente");
  if (!away) err("away", "Seleziona una squadra in trasferta esistente");
  if (home && away && home === away) err("away", "Le due squadre devono essere diverse");
  if (m.group && home && String(home.group) !== String(m.group)) warn("group", `${home.name} è nel girone ${home.group}`);
  if (m.group && away && String(away.group) !== String(m.group)) warn("group", `${away.name} è nel girone ${away.group}`);
  if (m.date && !ISO_DATE.test(String(m.date))) err("date", "Data non valida");
  const played = matchPlayed(m as never);
  if (String(m.status) === "Terminata" && !played) err("homeScore", "Per una partita terminata inserisci entrambi i punteggi");
  const goals: Record<string, number> = {};
  (Array.isArray(m.scorers) ? (m.scorers as Item[]) : []).forEach((s, i) => {
    if (!String(s?.name || "").trim()) return err(`scorers.${i}`, "Nome marcatore obbligatorio");
    const t = teamKey(s.team);
    if (t !== teamKey(m.home) && t !== teamKey(m.away)) return err(`scorers.${i}`, "Il marcatore deve appartenere a una delle due squadre");
    goals[t] = (goals[t] || 0) + Math.max(1, Number(s.goals) || 1);
    const roster = (t === teamKey(m.home) ? home : away)?.players || [];
    const names = roster.map((x) => teamKey(typeof x === "string" ? x : x.name));
    if (!isOwnGoal(s.name) && names.length && !names.includes(teamKey(s.name))) warn(`scorers.${i}`, `${s.name} non è nella rosa di ${s.team}`);
  });
  if (played) {
    for (const [side, score] of [[m.home, m.homeScore], [m.away, m.awayScore]] as Array<[string, number]>) {
      const g = goals[teamKey(side)] || 0;
      if (g > Number(score)) err("scorers", `${side}: i marcatori (${g}) superano i gol segnati (${score})`);
      else if (g && g < Number(score)) warn("scorers", `${side}: marcatori incompleti (${g} su ${score})`);
    }
  }
}

function checkLeagueTeam(league: LeagueData, t: Item, p: string, r: RuleResult) {
  const same = (league.teams || []).filter((x) => teamKey(x.name) === teamKey(t.name));
  if (same.length > 1) r.errors.push({ path: `${p}.name`, message: "Esiste già una squadra con questo nome" });
  const numbers = new Map<string, number>();
  (Array.isArray(t.players) ? t.players : []).forEach((pl, i) => {
    const player = typeof pl === "string" ? { name: pl } : (pl as Item);
    if (!String(player?.name || "").trim()) r.errors.push({ path: `${p}.players.${i}`, message: "Nome giocatore obbligatorio" });
    const n = String(player?.number ?? "").trim();
    if (n) numbers.set(n, (numbers.get(n) || 0) + 1);
  });
  for (const [n, c] of numbers) if (c > 1) r.warnings.push({ path: `${p}.players`, message: `Numero ${n} usato ${c} volte` });
}

function checkBracket(league: LeagueData, r: RuleResult) {
  const b = bracket(league);
  const all = [...b.quarters.map((m, i) => [`Quarto ${i + 1}`, m] as const), ...b.semis.map((m, i) => [`Semifinale ${i + 1}`, m] as const), ["Finale", b.final] as const];
  for (const [name, m] of all) {
    if (m.invalidManualWinner) r.errors.push({ path: "cusTrentoLeague.bracket", message: `${name}: la vincente indicata non è una delle due squadre` });
    if (m.needsManualWinner) r.warnings.push({ path: "cusTrentoLeague.bracket", message: `${name}: pareggio, indica la squadra qualificata` });
  }
}

function checkRoster(list: Item[], p: Item, path: string, r: RuleResult) {
  if (!(ROSTER_ROLES as readonly string[]).includes(String(p.role))) r.errors.push({ path: `${path}.role`, message: "Ruolo non valido" });
  if (!ROSTER_TEAMS.some((t) => t.value === p.team)) r.errors.push({ path: `${path}.team`, message: "Squadra non valida" });
  const n = Number(p.number);
  if (p.number === "" || p.number == null || !Number.isInteger(n) || n < 0 || n > 99) r.errors.push({ path: `${path}.number`, message: "Numero di maglia tra 0 e 99" });
  else if (list.some((x) => x !== p && x.team === p.team && Number(x.number) === n)) r.warnings.push({ path: `${path}.number`, message: `Numero ${n} già usato in questa squadra` });
  if (p.birthDate && !ISO_DATE.test(String(p.birthDate))) r.errors.push({ path: `${path}.birthDate`, message: "Data di nascita non valida" });
}

export function checkRules(doc: DocumentId, content: Record<string, unknown>, touched: Touched[], ctx: RuleContext = {}): RuleResult {
  const r: RuleResult = { errors: [], warnings: [] };
  const league = (content.cusTrentoLeague || {}) as LeagueData;
  for (const t of touched) {
    if (t.path) {
      const value = getAt(content, t.path);
      const p = t.path.join(".");
      findMarkup(value, p, r.errors);
      if (doc === "events" && t.path[0] === "cusTrentoLeague") checkBracket(league, r);
      continue;
    }
    if (!t.list || t.id == null) continue;
    const list = getAt(content, t.list);
    if (!Array.isArray(list)) continue;
    const index = list.findIndex((x) => isObject(x) && String(x.id) === t.id);
    if (index < 0) {
      if (doc === "roster" && ctx.matches) {
        const refs = playerReferences(ctx.matches, t.id);
        if (refs) r.errors.push({ path: `roster.${t.id}`, message: `Il giocatore compare in ${refs} partit${refs === 1 ? "a" : "e"}: eliminarlo cancellerebbe le sue statistiche. Spostalo di squadra invece di eliminarlo.` });
      }
      continue; // deleted
    }
    const item = list[index] as Item;
    const p = `${t.list.join(".")}.${index}`;
    findMarkup(item, p, r.errors);
    const key = t.list.join("/");
    if (doc === "fixtures" || doc === "u21Fixtures") checkMatch(doc, item, p, ctx, r);
    else if (doc === "roster") checkRoster(list as Item[], item, p, r);
    else if (doc === "news") {
      if (item.contentDoc != null && !richDocSchema.safeParse(item.contentDoc).success) r.errors.push({ path: `${p}.contentDoc`, message: "Contenuto dell'articolo non valido" });
      if (item.contentDoc == null && item.bodyHtml != null && (t.isNew || !isObject(t.before) || t.before.bodyHtml !== item.bodyHtml)) {
        r.errors.push({ path: `${p}.bodyHtml`, message: "L'HTML dell'articolo è generato dal server" });
      }
    } else if (key === "cusTrentoLeague/matches") {
      checkLeagueMatch(league, item, p, r);
      checkBracket(league, r);
    } else if (key === "cusTrentoLeague/teams") checkLeagueTeam(league, item, p, r);
  }
  // A deleted or renamed League team must not leave matches pointing at nothing.
  if (doc === "events" && touched.some((t) => t.list?.join("/") === "cusTrentoLeague/teams")) {
    const names = new Set((league.teams || []).map((t) => teamKey(t.name)));
    (league.matches || []).forEach((m, i) => {
      for (const side of [m.home, m.away]) if (!names.has(teamKey(side))) r.warnings.push({ path: `cusTrentoLeague.matches.${i}`, message: `La partita usa la squadra "${side}" che non esiste più` });
    });
  }
  r.errors = dedupe(r.errors);
  r.warnings = dedupe(r.warnings);
  return r;
}

function dedupe(list: RuleIssue[]) {
  const seen = new Set<string>();
  return list.filter((i) => (seen.has(i.path + i.message) ? false : (seen.add(i.path + i.message), true)));
}
