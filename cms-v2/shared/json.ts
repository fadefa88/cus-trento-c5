export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Serialization used by every CMS file in the repository (Decap and the Python tools agree). */
export function serializeDocument(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** JSON with sorted keys, so equal values always hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
      .join(",") +
    "}"
  );
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short fingerprint of a JSON value, used for optimistic concurrency on single items. */
export async function valueHash(value: unknown): Promise<string> {
  return (await sha256Hex(canonicalJson(value))).slice(0, 20);
}

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function getAt(root: unknown, path: readonly string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (UNSAFE_KEYS.has(key)) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(key)];
    else if (isObject(cur)) cur = cur[key];
    else return undefined;
  }
  return cur;
}

/** Sets a value at path, creating intermediate objects. Returns the mutated root. */
export function setAt<T>(root: T, path: readonly string[], value: unknown): T {
  if (!path.length) return value as T;
  if (path.some((k) => UNSAFE_KEYS.has(k))) throw new Error("unsafe path");
  let cur: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = Array.isArray(cur) ? cur[Number(key)] : (cur as Record<string, unknown>)[key];
    if (next === null || typeof next !== "object") {
      const created = /^\d+$/.test(path[i + 1]) ? [] : {};
      if (Array.isArray(cur)) cur[Number(key)] = created;
      else (cur as Record<string, unknown>)[key] = created;
      cur = created;
    } else cur = next;
  }
  const last = path[path.length - 1];
  if (Array.isArray(cur)) cur[Number(last)] = value;
  else (cur as Record<string, unknown>)[last] = value;
  return root;
}
