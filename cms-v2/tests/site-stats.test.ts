// Goalkeeper statistics as computed by the public site (real js/app.js code).
import { describe, expect, it } from "vitest";
import { extractFunction, readRepo } from "./helpers";

const app = readRepo("js/app.js");
const fns = ["toNumber", "normText", "toList", "statCount", "resolvePlayerId", "isGoalkeeperPlayer", "startingGoalkeeperId", "goalkeeperAgainstEvents"];
const goalkeeperAgainstEvents = new Function(`${fns.map((n) => extractFunction(app, n)).join("\n")}; return goalkeeperAgainstEvents;`)() as (m: unknown, roster: unknown[], against: number) => Array<{ playerId: string; goalsAgainst: number; appearances: number }>;
const roster = [{ id: "a", name: "Alfa", role: "Portiere" }, { id: "b", name: "Beta", role: "Portiere" }];

describe("site goalkeeper stats", () => {
  it("an explicit 0 goals against stays 0 instead of taking every goal of the match", () => {
    const events = goalkeeperAgainstEvents({ goalkeeperEvents: [{ playerId: "a", goalsAgainst: 4, appearances: 1 }, { playerId: "b", goalsAgainst: 0, appearances: 1 }] }, roster, 4);
    expect(events.map((e) => [e.playerId, e.goalsAgainst, e.appearances])).toEqual([["a", 4, 1], ["b", 0, 1]]);
  });
  it("legacy events without goalsAgainst keep the old fallback", () => {
    expect(goalkeeperAgainstEvents({ goalkeeperEvents: [{ playerId: "a" }] }, roster, 3)[0].goalsAgainst).toBe(3);
    expect(goalkeeperAgainstEvents({ lineup: { startingFive: ["b"] } }, roster, 2)).toEqual([{ playerId: "b", goalsAgainst: 2, minutes: 40, appearances: 1 }]);
  });
});
