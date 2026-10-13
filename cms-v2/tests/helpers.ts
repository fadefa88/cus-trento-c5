import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOCUMENTS, type DocumentId } from "../shared/documents";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));

export function readRepo(path: string): string {
  return readFileSync(REPO + path, "utf8").replace(/\r\n/g, "\n");
}

export function readDoc(doc: DocumentId): Record<string, unknown> {
  return JSON.parse(readRepo(DOCUMENTS[doc].file));
}

/** Extracts a named function declaration from a source file (brace matching, ignores strings poorly but enough for app.js). */
export function extractFunction(source: string, name: string): string {
  const start = source.search(new RegExp(`function ${name}\\s*\\(`));
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0;
  let i = source.indexOf("{", start);
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}
