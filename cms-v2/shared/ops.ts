// Edit operations. The client never uploads a whole file: it sends what it
// changed plus a fingerprint of the value it started from. The server replays
// the operations on the latest version of the file, so edits to different
// items merge, while two edits of the same item produce a conflict instead of
// silently overwriting each other.
import { z } from "zod";
import { DOCUMENTS, findList, type DocumentId, type ListDef } from "./documents";
import { clone, getAt, isObject, setAt, valueHash } from "./json";
import { SITE } from "./site";

const path = z.array(z.string().max(100).regex(/^[A-Za-z0-9_-]+$/)).min(1).max(8);
const id = z.string().min(1).max(200);
const hash = z.string().max(64);

export const opSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("upsert"), list: path, id: id.nullable(), value: z.record(z.string(), z.unknown()), base: hash.nullable(), position: z.enum(["start", "end"]).optional() }),
  z.strictObject({ type: z.literal("delete"), list: path, id, base: hash }),
  z.strictObject({ type: z.literal("move"), list: path, id, toIndex: z.number().int().min(0).max(100000) }),
  z.strictObject({ type: z.literal("set"), path, value: z.unknown(), base: hash }),
]);
export const opsSchema = z.array(opSchema).min(1).max(50);
export type Op = z.infer<typeof opSchema>;

export interface Conflict { op: number; path: string; reason: "changed" | "deleted" | "id-changed" | "not-a-list" | "unknown-list" | "duplicate-slug" }
export interface Touched { list?: string[]; id?: string; path?: string[]; isNew?: boolean; before?: unknown }
export interface ApplyResult { content: Record<string, unknown>; conflicts: Conflict[]; touched: Touched[] }

/** Lists whose items get an id without a site-core collection (CUS Trento League). */
const LEAGUE_ID_FIELDS: Record<string, string[]> = {
  "cusTrentoLeague/teams": ["name"],
  "cusTrentoLeague/matches": ["home", "away", "date"],
};

function slugFieldsFor(def: ListDef | undefined, listPath: string[]): string[] | null {
  if (def?.collection) return SITE.config.collections[def.collection]?.slugFields ?? null;
  if (def?.slugFields) return def.slugFields;
  return LEAGUE_ID_FIELDS[listPath.join("/")] ?? null;
}

function hasSlug(def: ListDef | undefined): boolean {
  return !!(def?.collection || def?.slugFields);
}

function assignIdentity(list: Array<Record<string, unknown>>, item: Record<string, unknown>, def: ListDef | undefined, listPath: string[]) {
  const fields = slugFieldsFor(def, listPath);
  if (!fields) return;
  const base = SITE.slugBase(item, fields);
  const ids = new Set(list.map((x) => String(x?.id ?? "")).filter(Boolean));
  item.id = SITE.uniqueSlug(base, ids);
  if (hasSlug(def)) {
    const slugs = new Set(list.map((x) => String(x?.slug ?? "")).filter(Boolean));
    const wanted = String(item.slug || "").trim();
    item.slug = SITE.uniqueSlug(wanted || base, slugs);
  }
}

export async function applyOps(doc: DocumentId, original: Record<string, unknown>, ops: Op[]): Promise<ApplyResult> {
  const content = clone(original);
  const conflicts: Conflict[] = [];
  const touched: Touched[] = [];

  for (const [index, op] of ops.entries()) {
    if (op.type === "set") {
      const current = getAt(content, op.path);
      if ((await valueHash(current ?? null)) !== op.base) {
        conflicts.push({ op: index, path: op.path.join("."), reason: "changed" });
        continue;
      }
      setAt(content, op.path, clone(op.value));
      touched.push({ path: op.path, before: current });
      continue;
    }

    const def = findList(doc, op.list);
    if (!def) {
      conflicts.push({ op: index, path: op.list.join("."), reason: "unknown-list" });
      continue;
    }
    let list = getAt(content, op.list);
    if (list === undefined || list === null) {
      list = [];
      setAt(content, op.list, list);
    }
    if (!Array.isArray(list)) {
      conflicts.push({ op: index, path: op.list.join("."), reason: "not-a-list" });
      continue;
    }
    const items = list as Array<Record<string, unknown>>;
    const pos = "id" in op && op.id != null ? items.findIndex((x) => isObject(x) && String(x.id) === op.id) : -1;
    const label = `${op.list.join(".")}[${"id" in op ? op.id ?? "nuovo" : ""}]`;

    if (op.type === "upsert") {
      const value = clone(op.value);
      if (op.id == null) {
        delete value.id;
        assignIdentity(items, value, def, op.list);
        if (op.position === "start") items.unshift(value);
        else items.push(value);
        touched.push({ list: op.list, id: value.id != null ? String(value.id) : undefined, isNew: true });
        continue;
      }
      if (pos < 0) {
        conflicts.push({ op: index, path: label, reason: "deleted" });
        continue;
      }
      if ((await valueHash(items[pos])) !== op.base) {
        conflicts.push({ op: index, path: label, reason: "changed" });
        continue;
      }
      if (value.id != null && String(value.id) !== op.id) {
        conflicts.push({ op: index, path: label, reason: "id-changed" });
        continue;
      }
      value.id = items[pos].id;
      if (hasSlug(def)) {
        const wanted = String(value.slug ?? "").trim() || String(items[pos].slug ?? "");
        const clash = items.some((x, i) => i !== pos && String(x?.slug ?? "") === wanted);
        if (clash) {
          conflicts.push({ op: index, path: label, reason: "duplicate-slug" });
          continue;
        }
        if (wanted) value.slug = SITE.slugify(wanted);
      }
      touched.push({ list: op.list, id: op.id, before: items[pos] });
      if (op.list.join("/") === "cusTrentoLeague/teams") renameLeagueTeam(content, String(items[pos].name ?? ""), String(value.name ?? ""));
      items[pos] = value;
    } else if (op.type === "delete") {
      if (pos < 0) continue; // already gone: the intent is satisfied
      if ((await valueHash(items[pos])) !== op.base) {
        conflicts.push({ op: index, path: label, reason: "changed" });
        continue;
      }
      items.splice(pos, 1);
      touched.push({ list: op.list, id: op.id });
    } else if (op.type === "move") {
      if (pos < 0) {
        conflicts.push({ op: index, path: label, reason: "deleted" });
        continue;
      }
      const [item] = items.splice(pos, 1);
      items.splice(Math.min(op.toIndex, items.length), 0, item);
    }
  }
  return { content, conflicts, touched };
}

/** League matches reference teams by name: a rename must follow them everywhere. */
function renameLeagueTeam(content: Record<string, unknown>, from: string, to: string) {
  const key = (v: unknown) => String(v ?? "").trim().toLowerCase();
  if (!from.trim() || !to.trim() || key(from) === key(to)) return;
  const league = content.cusTrentoLeague;
  if (!isObject(league)) return;
  for (const m of Array.isArray(league.matches) ? league.matches : []) {
    if (!isObject(m)) continue;
    if (key(m.home) === key(from)) m.home = to;
    if (key(m.away) === key(from)) m.away = to;
    for (const s of Array.isArray(m.scorers) ? m.scorers : []) if (isObject(s) && key(s.team) === key(from)) s.team = to;
  }
  const b = league.bracket;
  if (!isObject(b)) return;
  const games = [...(Array.isArray(b.quarterfinals) ? b.quarterfinals : []), ...(Array.isArray(b.semifinals) ? b.semifinals : []), b.final];
  for (const g of games) if (isObject(g) && key(g.winner) === key(from)) g.winner = to;
}

export function conflictMessage(c: Conflict): string {
  switch (c.reason) {
    case "changed": return `${c.path}: modificato da un'altra persona dopo che lo hai aperto`;
    case "deleted": return `${c.path}: eliminato da un'altra persona`;
    case "id-changed": return `${c.path}: l'ID non può essere cambiato`;
    case "duplicate-slug": return `${c.path}: lo slug è già usato da un altro elemento`;
    default: return `${c.path}: operazione non valida`;
  }
}

export function documentFile(doc: DocumentId) {
  return DOCUMENTS[doc].file;
}
