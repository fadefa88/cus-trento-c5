// The admin computes standings and the bracket with shared/league.ts; the public
// page uses js/app.js. These tests run the real app.js functions side by side.
import { describe, expect, it } from "vitest";
import { bracket, resolveKnockout, scorers, standings, type LeagueData } from "../shared/league";
import { knockoutMatch } from "../shared/schemas";
import { extractFunction, readDoc, readRepo } from "./helpers";

const app = readRepo("js/app.js");
const names = ["leagueTeamKey", "leagueMatchPlayed", "leagueStandings", "leagueKnockoutGames", "leagueScorers", "leagueKnockoutMatch"];
const source = names.map((n) => extractFunction(app, n)).join("\n");

function siteFunctions(league: LeagueData) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("leagueData", `${source}; return {${names.join(",")}};`)(() => league) as Record<string, (...a: unknown[]) => unknown>;
}

function team(name: string, group: "A" | "B") { return { id: name.toLowerCase(), name, group, players: [] }; }
function match(home: string, away: string, hs: number | null, as: number | null, group: "A" | "B", scorers: Array<{ name: string; team: string; goals?: number }> = []) {
  return { home, away, homeScore: hs, awayScore: as, group, status: hs === null ? "Da giocare" : "Terminata", scorers };
}

const synthetic: LeagueData = {
  teams: [team("Alfa", "A"), team("Beta", "A"), team("Gamma", "A"), team("Delta", "A"), team("Uno", "B"), team("Due", "B"), team("Tre", "B"), team("Quattro", "B")],
  matches: [
    match("Alfa", "Beta", 3, 1, "A", [{ name: "Rossi", team: "Alfa", goals: 2 }, { name: "Autogol", team: "Alfa" }, { name: "Bianchi", team: "Beta" }]),
    match("Gamma", "Delta", 2, 2, "A"),
    match("Alfa", "Gamma", 0, 1, "A"),
    match("Beta", "Delta", 5, 0, "A"),
    match("Uno", "Due", 1, 0, "B"),
    match("Tre", "Quattro", 0, 0, "B"),
    match("Uno", "Tre", 4, 4, "B", [{ name: "Verdi", team: "Uno", goals: 4 }]),
    match("Due", "Quattro", null, null, "B"),
  ],
  bracket: {
    quarterfinals: [{ team1Score: 2, team2Score: 2, winner: "Quattro", scorers: [{ name: "Rossi", team: "Alfa", goals: 2 }, { name: "Autogol", team: "Quattro" }] }, { team1Score: 1, team2Score: 3, scorers: [{ name: "Neri", team: "Tre", goals: 3 }] }, { team1Score: 2, team2Score: 2 }, { team1Score: 0, team2Score: 1, winner: "Nessuno" }],
    semifinals: [{ team1Score: 4, team2Score: 1 }, {}],
    final: {},
  },
};

describe("league parity with js/app.js", () => {
  for (const [label, league] of [["synthetic", synthetic], ["repository", (readDoc("events") as { cusTrentoLeague: LeagueData }).cusTrentoLeague]] as const) {
    it(`${label}: standings A and B are identical`, () => {
      const site = siteFunctions(league);
      for (const g of ["A", "B"]) expect(standings(league, g)).toEqual(site.leagueStandings(g));
    });
    it(`${label}: scorers ranking is identical and excludes own goals`, () => {
      const site = siteFunctions(league);
      expect(scorers(league)).toEqual(site.leagueScorers());
      expect(scorers(league).some((s) => /autogol/i.test(s.name))).toBe(false);
    });
  }

  it("knockout resolution is identical for every saved shape", () => {
    const site = siteFunctions(synthetic);
    const cases = [
      [{ team1Score: 2, team2Score: 1 }, "X", "Y"],
      [{ team1Score: 2, team2Score: 2 }, "X", "Y"],
      [{ team1Score: 2, team2Score: 2, winner: "y" }, "X", "Y"],
      [{ team1Score: 2, team2Score: 2, winner: "Z" }, "X", "Y"],
      [{ team1Score: "", team2Score: null }, "X", "Y"],
      [undefined, "X", "Y"],
      [{ team1Score: 0, team2Score: 3, winner: "X" }, "X", "Y"],
    ] as const;
    for (const [saved, a, b] of cases) {
      const { team1, team2, team1Score, team2Score, winner, scorers: sc } = resolveKnockout(saved as never, a, b);
      expect({ team1, team2, team1Score, team2Score, winner, scorers: sc }).toEqual(site.leagueKnockoutMatch(saved, a, b));
    }
  });
});

describe("bracket", () => {
  const b = bracket(synthetic);
  const a = standings(synthetic, "A").map((r) => r.team);
  const bb = standings(synthetic, "B").map((r) => r.team);

  it("pairs 1A-4B, 2A-3B, 3A-2B, 4A-1B", () => {
    expect(b.quarters.map((q) => [q.team1, q.team2])).toEqual([[a[0], bb[3]], [a[1], bb[2]], [a[2], bb[1]], [a[3], bb[0]]]);
  });
  it("draw uses the manual winner only when it is one of the two teams", () => {
    expect(b.quarters[0].winner).toBe(b.quarters[0].team2 === "Quattro" ? "Quattro" : "");
    expect(b.quarters[2].needsManualWinner).toBe(true);
    expect(b.quarters[3].invalidManualWinner).toBe(true);
    expect(b.quarters[3].winner).toBe(b.quarters[3].team2); // 0-1
  });
  it("knockout goals count in the scorers ranking, own goals excluded", () => {
    const rossi = scorers(synthetic).find((r) => r.name === "Rossi" && r.team === "Alfa")!;
    expect(rossi.goals).toBe(4); // 2 in the group stage + 2 in the quarterfinal
    expect(scorers(synthetic).find((r) => r.name === "Neri")!.goals).toBe(3);
  });
  it("semifinal 1 = winners of Q1 and Q2, semifinal 2 waits for Q3", () => {
    expect([b.semis[0].team1, b.semis[0].team2]).toEqual([b.quarters[0].winner || "Vincente quarto 1", b.quarters[1].winner]);
    expect(b.semis[1].team1).toBe("Vincente quarto 3");
    expect(b.final.team2).toBe("Vincente semifinale 2");
  });
});

describe("League fixture dates and calendar matchdays", () => {
  it("persists the same ISO date and time fields on knockout fixtures", () => {
    const scheduled = { name: "Quarto 1", date: "2026-11-02", time: "20:30", team1Score: null, team2Score: null, winner: "" };
    expect(knockoutMatch.safeParse(scheduled).success).toBe(true);
    expect(knockoutMatch.safeParse({ ...scheduled, date: "02/11/2026" }).success).toBe(false);
    const site = siteFunctions(synthetic);
    expect(resolveKnockout(scheduled, "Alfa", "Quattro")).toMatchObject({ date: "2026-11-02", time: "20:30" });
    expect(site.leagueKnockoutMatch(scheduled, "Alfa", "Quattro")).toMatchObject({ date: "2026-11-02", time: "20:30" });
    expect(bracket({ ...synthetic, bracket: { ...synthetic.bracket, quarterfinals: [scheduled] } }).quarters[0]).toMatchObject({ date: "2026-11-02", time: "20:30" });
  });

  it("shows the three matchdays separately with four matches per day and the selected tab active", () => {
    const league = (readDoc("events") as { cusTrentoLeague: LeagueData }).cusTrentoLeague;
    const matches = league.matches || [];
    const renderer = extractFunction(app, "leagueCalendarHtml");
    const render = (day: number) => new Function("view", "leagueMatchCard", "matches",
      `${renderer}; return leagueCalendarHtml(matches);`)(
      { leagueRound: day }, (m: { id: string }) => `<article data-fixture="${m.id}"></article>`, matches,
    ) as string;
    const html = render(2);
    const panels = [...html.matchAll(/<div class="ctl-matches ctl-calendar-matches" data-league-round="(\\d)"([^>]*)>([\\s\\S]*?)<\\/div>/g)];
    expect(panels).toHaveLength(3);
    for (const [i, panel] of panels.entries()) {
      const day = i + 1;
      expect(Number(panel[1])).toBe(day);
      expect((panel[3].match(/data-fixture=/g) || [])).toHaveLength(4);
      expect(panel[2].includes("hidden")).toBe(day !== 2);
    }
    expect(html).toContain('data-league-round="2" class="active" aria-pressed="true"');
    expect(render(1)).toContain('data-league-round="1" class="active" aria-pressed="true"');
  });
});

describe("league rules on the public page", () => {
  const rulesFns = ["h", "leagueRulesText", "leagueCustomRulesHtml", "leagueRulesHtml"];
  // app.js has several helpers named h(); the League one is the last before leagueRulesHtml.
  const start = app.lastIndexOf("function h(value)", app.indexOf("function leagueRulesHtml"));
  const hSource = extractFunction(app.slice(start), "h");
  const source = [hSource, ...rulesFns.slice(1).map((n) => extractFunction(app, n))].join("\n");
  const render = (league: Record<string, unknown>) =>
    new Function("leagueData", `${source}; return leagueRulesHtml();`)(() => league) as string;
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, (e) => ({ "&amp;": "&", "&#039;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">" })[e] ?? e).replace(/\s+/g, " ").trim();

  it("default rules from the CMS render the same text as the current page", async () => {
    const { DEFAULT_RULES } = await import("../shared/league-rules");
    expect(text(render({ rules: DEFAULT_RULES, venue: "" }))).toBe(text(render({ venue: "" })));
  });
  it("custom rules escape HTML and only allow bold and safe links", () => {
    const html = render({ rules: { heading: "<img src=x onerror=alert(1)>", intro: "**Ciao** [sito](https://x.it) [js](javascript:alert(1)) <script>x</script>", sections: [{ title: "T", paragraphs: ['[a](https://x.it" onmouseover="alert(1))'] }] } });
    expect(html).not.toMatch(/<img|<script|href="javascript|onmouseover="/i);
    expect(html).toContain("[js](javascript:alert(1))"); // left as plain, escaped text
    expect(html).toContain("<b>Ciao</b>");
    expect(html).toContain('<a href="https://x.it" target="_blank" rel="noopener noreferrer">sito</a>');
  });
});
