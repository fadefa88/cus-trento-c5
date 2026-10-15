// CUS Trento League rules. Standings, scorers and the knockout bracket mirror
// the functions the public site uses to render them (js/app.js:
// leagueStandings, leagueScorers, leagueKnockoutMatch, leagueBracketHtml), so the
// admin preview always matches the published page. Tests pin the behaviour.
import { LEAGUE_OWN_GOAL } from "./documents";

export interface LeaguePlayer { number?: string | number | null; name: string; role?: string | null }
export interface LeagueTeam { id?: string; name: string; logo?: string | null; group: "A" | "B" | string; players?: Array<LeaguePlayer | string> | null }
export interface LeagueScorer { name: string; team?: string; goals?: number }
export interface LeagueMatch {
  id?: string;
  date?: string | null;
  time?: string | null;
  group?: string | null;
  round?: string | null;
  home: string;
  away: string;
  homeScore?: number | null;
  awayScore?: number | null;
  status?: string | null;
  scorers?: LeagueScorer[] | null;
}
export interface KnockoutSaved { name?: string; date?: string | null; time?: string | null; team1Score?: number | null; team2Score?: number | null; winner?: string | null; scorers?: LeagueScorer[] | null; [k: string]: unknown }
export interface LeagueData {
  title?: string;
  edition?: string;
  teams?: LeagueTeam[] | null;
  matches?: LeagueMatch[] | null;
  bracket?: { format?: string | null; quarterfinals?: KnockoutSaved[] | null; semifinals?: KnockoutSaved[] | null; final?: KnockoutSaved | null } | null;
  [k: string]: unknown;
}

export interface StandingRow { team: string; g: number; v: number; n: number; p: number; gf: number; gs: number; pts: number }

export const teamKey = (value: unknown) => String(value || "").trim().toLowerCase();
export const isOwnGoal = (name: unknown) => /^autogol$/i.test(String(name || "").trim());

const filled = (v: unknown) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

export function matchPlayed(match: Pick<LeagueMatch, "homeScore" | "awayScore">): boolean {
  return filled(match.homeScore) && filled(match.awayScore);
}

export function standings(league: LeagueData, group: string): StandingRow[] {
  const g = String(group || "").toUpperCase();
  const rows = new Map<string, StandingRow>();
  for (const team of league.teams || []) {
    if (String(team.group || "").toUpperCase() === g) rows.set(teamKey(team.name), { team: team.name, g: 0, v: 0, n: 0, p: 0, gf: 0, gs: 0, pts: 0 });
  }
  for (const match of league.matches || []) {
    if (String(match.group || "").toUpperCase() !== g || !matchPlayed(match)) continue;
    const home = rows.get(teamKey(match.home));
    const away = rows.get(teamKey(match.away));
    if (!home || !away) continue;
    const hg = Number(match.homeScore), ag = Number(match.awayScore);
    home.g++; away.g++; home.gf += hg; home.gs += ag; away.gf += ag; away.gs += hg;
    if (hg > ag) { home.v++; home.pts += 3; away.p++; }
    else if (hg < ag) { away.v++; away.pts += 3; home.p++; }
    else { home.n++; away.n++; home.pts++; away.pts++; }
  }
  return [...rows.values()].sort(
    (a, b) => b.pts - a.pts || b.gf - b.gs - (a.gf - a.gs) || b.gf - a.gf || a.team.localeCompare(b.team, "it"),
  );
}

export interface ScorerRow { name: string; team: string; goals: number }

/** Top scorers. Own goals appear in the match report but never here. */
/** Saved knockout games (quarterfinals, semifinals, final), in that order. */
export function knockoutGames(league: LeagueData): KnockoutSaved[] {
  const b = league.bracket || {};
  return [...(b.quarterfinals || []), ...(b.semifinals || []), ...(b.final ? [b.final] : [])].filter((g): g is KnockoutSaved => !!g && typeof g === "object");
}

export function scorers(league: LeagueData): ScorerRow[] {
  const map = new Map<string, ScorerRow>();
  for (const match of [...(league.matches || []), ...knockoutGames(league)]) {
    for (const item of match.scorers || []) {
      const name = String(item?.name || "").trim();
      if (!name || isOwnGoal(name)) continue;
      const team = String(item?.team || "").trim();
      const key = teamKey(name) + "|" + teamKey(team);
      if (!map.has(key)) map.set(key, { name, team, goals: 0 });
      map.get(key)!.goals += Math.max(1, Number(item.goals) || 1);
    }
  }
  return [...map.values()].sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name, "it"));
}

export interface KnockoutResolved { team1: string; team2: string; date: string; time: string; team1Score: number | null; team2Score: number | null; winner: string; scorers: LeagueScorer[]; needsManualWinner: boolean; invalidManualWinner: boolean }

export function resolveKnockout(saved: KnockoutSaved | null | undefined, team1: string, team2: string): KnockoutResolved {
  const value = (raw: unknown) => (filled(raw) ? Number(raw) : null);
  const first = value(saved?.team1Score);
  const second = value(saved?.team2Score);
  const manual = String(saved?.winner || "").trim();
  const validManual = [team1, team2].find((t) => teamKey(t) === teamKey(manual));
  let winner = validManual || "";
  if (!winner && first !== null && second !== null && first !== second) winner = first > second ? team1 : team2;
  return {
    team1, team2, date: String(saved?.date || ""), time: String(saved?.time || ""), team1Score: first, team2Score: second, winner,
    scorers: Array.isArray(saved?.scorers) ? saved!.scorers! : [],
    needsManualWinner: first !== null && second !== null && first === second && !validManual,
    invalidManualWinner: !!manual && !validManual,
  };
}

export const PAIRINGS: Array<[number, number, string, string]> = [
  [0, 3, "1ª A", "4ª B"],
  [1, 2, "2ª A", "3ª B"],
  [2, 1, "3ª A", "2ª B"],
  [3, 0, "4ª A", "1ª B"],
];

export interface Bracket {
  quarters: Array<KnockoutResolved & { seeds: [string, string] }>;
  semis: Array<KnockoutResolved & { seeds: [string, string] }>;
  final: KnockoutResolved & { seeds: [string, string] };
  champion: string;
}

export function bracket(league: LeagueData): Bracket {
  const b = league.bracket || {};
  const q = b.quarterfinals || [];
  const s = b.semifinals || [];
  const a = standings(league, "A"), bb = standings(league, "B");
  const at = (rows: StandingRow[], i: number) => rows[i]?.team || "Da definire";
  const quarters = PAIRINGS.map(([ia, ib, sa, sb], i) => ({ ...resolveKnockout(q[i], at(a, ia), at(bb, ib)), seeds: [sa, sb] as [string, string] }));
  const semis = [
    { ...resolveKnockout(s[0], quarters[0].winner || "Vincente quarto 1", quarters[1].winner || "Vincente quarto 2"), seeds: ["VQ1", "VQ2"] as [string, string] },
    { ...resolveKnockout(s[1], quarters[2].winner || "Vincente quarto 3", quarters[3].winner || "Vincente quarto 4"), seeds: ["VQ3", "VQ4"] as [string, string] },
  ];
  const final = { ...resolveKnockout(b.final, semis[0].winner || "Vincente semifinale 1", semis[1].winner || "Vincente semifinale 2"), seeds: ["VS1", "VS2"] as [string, string] };
  return { quarters, semis, final, champion: final.winner };
}

/** Players a scorer can be chosen from: the two teams of the match, plus the own goal option. */
export function matchScorerChoices(league: LeagueData, home: string, away: string) {
  const out: Array<{ name: string; team: string; number?: string }> = [];
  for (const team of league.teams || []) {
    if (teamKey(team.name) !== teamKey(home) && teamKey(team.name) !== teamKey(away)) continue;
    for (const p of team.players || []) {
      const player = typeof p === "string" ? { name: p } : p;
      if (player?.name) out.push({ name: player.name, team: team.name, number: player.number != null ? String(player.number) : undefined });
    }
  }
  return out;
}

export const OWN_GOAL_NAME = LEAGUE_OWN_GOAL;

export function emptyBracket() {
  const ko = (name: string) => ({ name, team1Score: null, team2Score: null, winner: "" });
  return {
    format: "Quarti, semifinali e finale a eliminazione diretta",
    quarterfinals: [1, 2, 3, 4].map((n) => ko(`Quarto ${n}`)),
    semifinals: [1, 2].map((n) => ko(`Semifinale ${n}`)),
    final: ko("Finale"),
  };
}
