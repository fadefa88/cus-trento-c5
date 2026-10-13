// Regression tests on the real repository content: Admin V2 must accept every
// file as it is today and must not change anything it was not asked to change.
import { describe, expect, it } from "vitest";
import { DOCUMENT_IDS, DOCUMENTS } from "../shared/documents";
import { serializeDocument } from "../shared/json";
import { normalizeDocument } from "../shared/normalize";
import { validateDocument } from "../shared/schemas";
import { SITE } from "../shared/site";
import { readDoc, readRepo } from "./helpers";

describe("repository content", () => {
  it("manages exactly the CMS files listed in js/site-core.js (the list scripts/site_data.py merges)", () => {
    const declared = (SITE.config as unknown as { cmsFiles: string[] }).cmsFiles;
    expect(Object.values(DOCUMENTS).map((d) => d.file)).toEqual(declared);
  });

  it("uses the collections defined in js/site-core.js", () => {
    for (const doc of DOCUMENT_IDS) {
      for (const list of DOCUMENTS[doc].lists) if (list.collection) expect(SITE.config.collections[list.collection], list.collection).toBeDefined();
    }
  });

  for (const doc of DOCUMENT_IDS) {
    it(`${doc}: current file passes validation`, () => {
      expect(validateDocument(doc, readDoc(doc))).toEqual([]);
    });

    it(`${doc}: normalization is a no-op on current data (no spurious diff)`, () => {
      const content = readDoc(doc);
      expect(serializeDocument(normalizeDocument(doc, content))).toBe(serializeDocument(content));
    });

    it(`${doc}: serialization reproduces the file byte for byte`, () => {
      const raw = readRepo(DOCUMENTS[doc].file);
      expect(serializeDocument(JSON.parse(raw))).toBe(raw);
    });
  }
});
