// Automatic fields applied on every save, the same ones the former Decap CMS
// applied (its custom.js and preSave hook), plus the news
// HTML rendering. Applied to unchanged data it is a no-op (see tests).
import { DOCUMENTS, type DocumentId } from "./documents";
import { getAt, isObject, setAt } from "./json";
import { emptyBracket } from "./league";
import { renderRichHtml, richDocSchema, richParagraphs, type RichDoc } from "./richtext";
import { SITE } from "./site";

function withIdsAndSlugs(items: unknown[], fields: string[]): unknown[] {
  const computed = SITE.computeIdsAndSlugs(items, fields);
  return items.map((item, i) => (computed[i] && isObject(item) ? { ...item, id: computed[i]!.id, slug: computed[i]!.slug } : item));
}

function isDraftMatch(match: Record<string, unknown>): boolean {
  const status = String(match.status || "").toLowerCase();
  return !status || status.includes("giocare") || status.includes("programm");
}

function normalizeMatch(match: unknown): unknown {
  if (!isObject(match) || !isDraftMatch(match)) return match;
  const lineup = isObject(match.lineup) ? { ...match.lineup } : {};
  for (const field of ["startingFive", "bench", "suspended", "injured"]) {
    if (lineup[field] == null || lineup[field] === "") lineup[field] = [];
  }
  return { ...match, lineup };
}

function normalizeNews(item: unknown): unknown {
  if (!isObject(item) || item.contentDoc == null) return item;
  const parsed = richDocSchema.safeParse(item.contentDoc);
  if (!parsed.success) return item; // rejected later by the rules
  const doc = parsed.data as RichDoc;
  return { ...item, bodyHtml: renderRichHtml(doc), body: richParagraphs(doc) };
}

function uniqueIds(items: unknown[], fields: string[]): unknown[] {
  const used = new Set<string>();
  return items.map((item) => {
    if (!isObject(item)) return item;
    const current = String(item.id ?? "").trim();
    if (current && !used.has(current)) {
      used.add(current);
      return item;
    }
    return { ...item, id: SITE.uniqueSlug(current || SITE.slugBase(item, fields), used) };
  });
}

function normalizeLeague(league: unknown): unknown {
  if (!isObject(league)) return league;
  const out: Record<string, unknown> = { ...league };
  if (Array.isArray(out.teams)) out.teams = uniqueIds(out.teams, ["name"]);
  if (Array.isArray(out.matches)) out.matches = uniqueIds(out.matches, ["home", "away", "date"]);
  const empty = emptyBracket();
  const b = isObject(out.bracket) ? { ...out.bracket } : { ...empty };
  const fill = (stored: unknown, defaults: Array<Record<string, unknown>>) => {
    const list = Array.isArray(stored) ? [...stored] : [];
    for (let i = list.length; i < defaults.length; i++) list.push({ ...defaults[i] });
    return list;
  };
  b.quarterfinals = fill(b.quarterfinals, empty.quarterfinals);
  b.semifinals = fill(b.semifinals, empty.semifinals);
  if (!isObject(b.final)) b.final = { ...empty.final };
  out.bracket = b;
  return out;
}

export function normalizeDocument(doc: DocumentId, input: Record<string, unknown>): Record<string, unknown> {
  let content: Record<string, unknown> = { ...input };
  for (const list of DOCUMENTS[doc].lists) {
    const items = getAt(content, list.path);
    if (!Array.isArray(items)) continue;
    const fields = list.collection ? SITE.config.collections[list.collection]?.slugFields : list.slugFields;
    if (fields) {
      content = structuredCloneShallow(content, list.path);
      setAt(content, list.path, withIdsAndSlugs(items, fields));
    }
  }
  if (doc === "fixtures" || doc === "u21Fixtures") {
    const items = content[doc];
    if (Array.isArray(items)) content[doc] = items.map(normalizeMatch);
  }
  if (doc === "news" && Array.isArray(content.news)) content.news = content.news.map(normalizeNews);
  if (doc === "events" && content.cusTrentoLeague !== undefined) content.cusTrentoLeague = normalizeLeague(content.cusTrentoLeague);
  return content;
}

/** Copies the objects along `path` so setAt does not mutate the caller's data. */
function structuredCloneShallow(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
  const out = { ...root };
  let cur: Record<string, unknown> = out;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]];
    if (!isObject(next)) break;
    cur[path[i]] = { ...next };
    cur = cur[path[i]] as Record<string, unknown>;
  }
  return out;
}
