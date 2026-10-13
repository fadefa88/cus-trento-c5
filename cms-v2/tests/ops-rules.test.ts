import { describe, expect, it } from "vitest";
import { clone, getAt, valueHash } from "../shared/json";
import { applyOps } from "../shared/ops";
import { processEdit } from "../shared/pipeline";
import { legacyNewsToDoc, renderRichHtml, richDocSchema, richParagraphs } from "../shared/richtext";
import { readDoc } from "./helpers";

type Item = Record<string, unknown>;
const roster = () => readDoc("roster") as { roster: Item[] };
const fixtures = () => readDoc("fixtures") as { fixtures: Item[] };
const events = () => readDoc("events") as { events: Item[]; cusTrentoLeague: { teams: Item[]; matches: Item[]; bracket: Item } };

describe("operations", () => {
  it("adds a player with an id and slug that do not collide and keeps every other item untouched", async () => {
    const before = roster();
    const res = await processEdit("roster", before, [
      { type: "upsert", list: ["roster"], id: null, base: null, value: { name: "Safi Saif Edine", role: "Portiere", team: "Prima squadra", number: 99 } },
    ]);
    expect(res.errors).toEqual([]);
    const list = res.content.roster as Item[];
    expect(list.slice(0, -1)).toEqual(before.roster);
    const added = list[list.length - 1];
    expect(added.slug).toBe("safi-saif-edine-2");
    expect(before.roster.some((p) => p.id === added.id)).toBe(false);
  });

  it("keeps id and slug (the public URL) when an item is edited", async () => {
    const doc = fixtures();
    const target = doc.fixtures.find((m) => m.home === "Trento")!;
    const res = await processEdit("fixtures", doc, [
      { type: "upsert", list: ["fixtures"], id: String(target.id), base: await valueHash(target), value: { ...target, venue: "Sanbàpolis", slug: undefined } },
    ]);
    expect(res.conflicts).toEqual([]);
    const after = (res.content.fixtures as Item[]).find((m) => m.id === target.id)!;
    expect(after.slug).toBe(target.slug);
    expect(after.venue).toBe("Sanbàpolis");
  });

  it("detects a concurrent edit of the same item but merges edits of different items", async () => {
    const doc = roster();
    const [a, b] = doc.roster;
    const baseA = await valueHash(a);
    const first = await applyOps("roster", doc, [{ type: "upsert", list: ["roster"], id: String(a.id), base: baseA, value: { ...a, faculty: "Fisica" } }]);
    const sameItem = await applyOps("roster", first.content, [{ type: "upsert", list: ["roster"], id: String(a.id), base: baseA, value: { ...a, birthPlace: "Trento" } }]);
    expect(sameItem.conflicts.map((c) => c.reason)).toEqual(["changed"]);
    const otherItem = await applyOps("roster", first.content, [{ type: "upsert", list: ["roster"], id: String(b.id), base: await valueHash(b), value: { ...b, birthPlace: "Trento" } }]);
    expect(otherItem.conflicts).toEqual([]);
  });

  it("refuses to delete an item someone else modified, ignores one already deleted", async () => {
    const doc = roster();
    const a = doc.roster[0];
    const stale = await applyOps("roster", doc, [{ type: "delete", list: ["roster"], id: String(a.id), base: "0000" }]);
    expect(stale.conflicts[0].reason).toBe("changed");
    const ok = await applyOps("roster", doc, [{ type: "delete", list: ["roster"], id: String(a.id), base: await valueHash(a) }]);
    expect((ok.content.roster as Item[]).length).toBe(doc.roster.length - 1);
    const again = await applyOps("roster", ok.content, [{ type: "delete", list: ["roster"], id: String(a.id), base: await valueHash(a) }]);
    expect(again.conflicts).toEqual([]);
  });

  it("rejects a slug already used by another item", async () => {
    const doc = roster();
    const [a, b] = doc.roster;
    const res = await applyOps("roster", doc, [{ type: "upsert", list: ["roster"], id: String(a.id), base: await valueHash(a), value: { ...a, slug: b.slug } }]);
    expect(res.conflicts[0].reason).toBe("duplicate-slug");
  });

  it("renaming a League team follows matches, scorers and bracket winners", async () => {
    const doc = events();
    const team = doc.cusTrentoLeague.teams.find((t) => t.name === "Rango FC")!;
    const res = await processEdit("events", doc, [
      { type: "upsert", list: ["cusTrentoLeague", "teams"], id: String(team.id), base: await valueHash(team), value: { ...team, name: "Rango Futsal" } },
    ]);
    expect(res.errors).toEqual([]);
    const league = res.content.cusTrentoLeague as { matches: Item[] };
    const json = JSON.stringify(league.matches);
    expect(json).not.toContain('"Rango FC"');
    expect(json).toContain('"Rango Futsal"');
  });

  it("set operation is guarded by the hash of the previous value", async () => {
    const doc = events();
    const path = ["cusTrentoLeague", "bracket", "quarterfinals", "0"];
    const base = await valueHash(getAt(doc, path));
    const ok = await applyOps("events", doc, [{ type: "set", path, base, value: { name: "Quarto 1", team1Score: 3, team2Score: 1, winner: "" } }]);
    expect(ok.conflicts).toEqual([]);
    const stale = await applyOps("events", ok.content, [{ type: "set", path, base, value: {} }]);
    expect(stale.conflicts[0].reason).toBe("changed");
  });
});

describe("match rules", () => {
  async function editFirst(doc: "fixtures" | "u21Fixtures", patch: (m: Item) => Item) {
    const content = readDoc(doc) as Record<string, Item[]>;
    const m = content[doc].find((x) => x.status === "Terminata")!;
    return processEdit(doc, content, [{ type: "upsert", list: [doc], id: String(m.id), base: await valueHash(m), value: patch(clone(m)) }], { roster: roster().roster });
  }

  it("a terminated match with valid data passes", async () => {
    expect((await editFirst("fixtures", (m) => m)).errors).toEqual([]);
  });
  it("blocks duplicates between starting five and bench", async () => {
    const res = await editFirst("fixtures", (m) => {
      const l = m.lineup as { startingFive: string[]; bench: string[] };
      l.bench = [...l.bench, l.startingFive[0]];
      return m;
    });
    expect(res.errors.map((e) => e.message)).toContain("Un giocatore non può essere sia titolare sia in panchina");
  });
  it("U23 terminated match needs exactly five starters", async () => {
    const res = await editFirst("u21Fixtures", (m) => {
      (m.lineup as { startingFive: string[] }).startingFive.pop();
      return m;
    });
    expect(res.errors.some((e) => e.message.includes("esattamente 5"))).toBe(true);
  });
  it("scorer must be in the lineup, own goal is always allowed", async () => {
    const res = await editFirst("fixtures", (m) => ({ ...m, scorerEvents: [{ playerId: "autogol", goals: 1 }, { playerId: "zago-alessandro", goals: 1 }] }));
    const messages = res.errors.map((e) => e.message).join("|");
    const lineup = (fixtures().fixtures.find((x) => x.status === "Terminata")!.lineup as { startingFive: string[]; bench: string[] });
    if (![...lineup.startingFive, ...lineup.bench].includes("zago-alessandro")) expect(messages).toContain("non è tra titolari o panchina");
    expect(messages).not.toContain("autogol");
  });
  it("unknown player ids are rejected", async () => {
    const res = await editFirst("fixtures", (m) => ({ ...m, yellowCardEvents: [{ playerId: "non-esiste", cards: 1 }] }));
    expect(res.errors.some((e) => e.message.includes("sconosciuto"))).toBe(true);
  });
  it("markup in text fields is rejected", async () => {
    const res = await editFirst("fixtures", (m) => ({ ...m, venue: '<img src=x onerror="alert(1)">' }));
    expect(res.errors.some((e) => e.message.includes("tag HTML"))).toBe(true);
  });
  it("image URLs that could break out of an attribute are rejected", async () => {
    const res = await editFirst("fixtures", (m) => ({ ...m, opponentLogo: '/img/a.png" onerror="alert(1)' }));
    expect(res.errors.length).toBeGreaterThan(0);
    const js = await editFirst("fixtures", (m) => ({ ...m, opponentLogo: "javascript:alert(1)" }));
    expect(js.errors.length).toBeGreaterThan(0);
  });
});

describe("league rules", () => {
  it("scorer must belong to one of the two teams and cannot exceed the score", async () => {
    const doc = events();
    const m = doc.cusTrentoLeague.matches[0];
    const res = await processEdit("events", doc, [
      { type: "upsert", list: ["cusTrentoLeague", "matches"], id: String(m.id), base: await valueHash(m), value: { ...m, homeScore: 1, scorers: [{ name: "X", team: "Golosoni", goals: 1 }, { name: "Kasa", team: m.home, goals: 2 }] } },
    ]);
    const messages = res.errors.map((e) => e.message).join("|");
    expect(messages).toContain("una delle due squadre");
    expect(messages).toContain("superano");
  });
  it("home and away must be existing, different teams", async () => {
    const doc = events();
    const res = await processEdit("events", doc, [
      { type: "upsert", list: ["cusTrentoLeague", "matches"], id: null, base: null, value: { home: "Golosoni", away: "Golosoni", group: "A", date: "2026-11-02" } },
      { type: "upsert", list: ["cusTrentoLeague", "matches"], id: null, base: null, value: { home: "Inventata", away: "Golosoni", group: "A", date: "2026-11-02" } },
    ]);
    const messages = res.errors.map((e) => e.message);
    expect(messages).toContain("Le due squadre devono essere diverse");
    expect(messages).toContain("Seleziona una squadra di casa esistente");
  });
  it("new League match gets an id in the existing format", async () => {
    const doc = events();
    const res = await processEdit("events", doc, [
      { type: "upsert", list: ["cusTrentoLeague", "matches"], id: null, base: null, value: { home: "Golosoni", away: "Rango FC", group: "A", date: "2026-11-02", status: "Da giocare" } },
    ]);
    expect(res.errors).toEqual([]);
    const matches = (res.content.cusTrentoLeague as { matches: Item[] }).matches;
    expect(matches[matches.length - 1].id).toBe("golosoni-rango-fc-2026-11-02");
  });
});

describe("news rich text", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Titolo 3 < 4 & 5 > 2" }] },
      { type: "paragraph", content: [{ type: "text", text: "Vittoria", marks: [{ type: "bold" }] }, { type: "text", text: " & link", marks: [{ type: "link", attrs: { href: "https://example.org/?a=1&b=2" } }] }] },
      { type: "image", attrs: { src: "/img/uploads/foto.webp", alt: "Foto", title: "Didascalia" } },
    ],
  };
  it("renders escaped HTML", () => {
    const parsed = richDocSchema.parse(doc);
    const html = renderRichHtml(parsed as never);
    expect(html).toContain("<h2>Titolo 3 &lt; 4 &amp; 5 &gt; 2</h2>");
    expect(html).toContain('<a href="https://example.org/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"> &amp; link</a>');
    expect(html).toContain("<figcaption>Didascalia</figcaption>");
    expect(richParagraphs(parsed as never)).toEqual(["Titolo 3 < 4 & 5 > 2", "Vittoria & link"]);
  });
  it("rejects javascript links, unknown nodes and attributes", () => {
    const bad = (node: unknown) => richDocSchema.safeParse({ type: "doc", content: [node] }).success;
    expect(bad({ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] })).toBe(false);
    expect(bad({ type: "iframe", attrs: { src: "https://x" } })).toBe(false);
    expect(bad({ type: "paragraph", attrs: {}, content: [{ type: "text", text: "x", onclick: "y" }] })).toBe(false);
    expect(bad({ type: "image", attrs: { src: 'x" onerror="1' } })).toBe(false);
  });
  it("server renders bodyHtml/body and refuses client HTML", async () => {
    const created = await processEdit("news", { news: [] }, [
      { type: "upsert", list: ["news"], id: null, base: null, position: "start", value: { title: "Prova", date: "2026-10-13", contentDoc: doc, bodyHtml: "<script>alert(1)</script>" } },
    ]);
    expect(created.errors).toEqual([]);
    const item = (created.content.news as Item[])[0];
    expect(item.bodyHtml).not.toContain("<script>");
    expect(item.slug).toBe("prova-2026-10-13");
    const tagged = await processEdit("news", { news: [] }, [
      { type: "upsert", list: ["news"], id: null, base: null, value: { title: "Y", date: "2026-10-13", contentDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>" }] }] } } },
    ]);
    expect(tagged.errors.some((e) => e.message.includes("tag HTML"))).toBe(true);
    const forged = await processEdit("news", { news: [] }, [
      { type: "upsert", list: ["news"], id: null, base: null, value: { title: "X", date: "2026-10-13", bodyHtml: "<b>x</b>" } },
    ]);
    expect(forged.errors.some((e) => e.path.endsWith("bodyHtml"))).toBe(true);
  });
  it("converts legacy Decap body and content blocks for editing", () => {
    expect(legacyNewsToDoc({ body: ["a", "b"] }).content).toHaveLength(2);
    const blocks = legacyNewsToDoc({ contentBlocks: [{ type: "paragraph", text: "t" }, { type: "image", image: "/img/uploads/a.png", caption: "c" }] });
    expect(blocks.content.map((n) => n.type)).toEqual(["paragraph", "image"]);
  });
});
