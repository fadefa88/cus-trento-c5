// Shared site rules come from js/site-core.js, the same file used by the public
// site, the Decap CMS and (through its Python port) the static generator.
// Importing it for its side effect defines globalThis.CUS_SITE.
import "../../js/site-core.js";

export interface CollectionDef {
  slugFields: string[];
  urlBase: string;
  routePrefix: string;
  breadcrumb?: [string, string];
}

export interface SiteCore {
  config: {
    siteUrl: string;
    slug: { maxLength: number; fallback: string };
    collections: Record<string, CollectionDef>;
    nestedSlugLists: Array<{ object: string; list: string; slugFields: string[] }>;
    hiddenNewsTitles: string[];
  };
  slugify(value: unknown): string;
  slugBase(item: Record<string, unknown>, fields: string[]): string;
  uniqueSlug(base: string, used: Set<string>): string;
  computeIdsAndSlugs(items: unknown[], fields: string[]): Array<{ id: string; slug: string } | null>;
  objectSlug(item: Record<string, unknown>, collection: string): string;
  itemPath(collection: string, item: Record<string, unknown>): string;
  publicYouthText(value: unknown): string;
}

const site = (globalThis as unknown as { CUS_SITE?: SiteCore }).CUS_SITE;
if (!site) throw new Error("js/site-core.js did not define CUS_SITE");

export const SITE: SiteCore = site;
export const SITE_URL = SITE.config.siteUrl.replace(/\/$/, "");

/** Public URL of a collection item, exactly as the site and the generator build it. */
export function publicUrl(collection: string, item: Record<string, unknown>): string | null {
  if (!SITE.config.collections[collection]) return null;
  return SITE_URL + SITE.itemPath(collection, item);
}
