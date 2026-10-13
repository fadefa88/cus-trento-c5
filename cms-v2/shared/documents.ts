// The CMS files Admin V2 manages: the "cmsFiles" list of js/site-core.js, which
// scripts/site_data.py merges into content/data.json; a test checks they match.

export const DOCUMENT_IDS = [
  "news",
  "roster",
  "fixtures",
  "u21Fixtures",
  "galleryAlbums",
  "sponsors",
  "sponsorPackages",
  "staff",
  "videos",
  "clubHistory",
  "events",
] as const;

export type DocumentId = (typeof DOCUMENT_IDS)[number];

export interface ListDef {
  /** JSON path of the array inside the file. */
  path: string[];
  /** Key of js/site-core.js collections (ID/slug rules and public URL), if any. */
  collection?: string;
  /** Slug fields for nested lists not registered as collections. */
  slugFields?: string[];
  label: string;
}

export interface DocumentDef {
  id: DocumentId;
  file: string;
  label: string;
  /** Lists whose items can be added, edited, deleted and reordered. */
  lists: ListDef[];
}

export const DOCUMENTS: Record<DocumentId, DocumentDef> = {
  news: { id: "news", file: "content/cms/news.json", label: "News", lists: [{ path: ["news"], collection: "news", label: "Articoli" }] },
  roster: { id: "roster", file: "content/cms/roster.json", label: "Rosa giocatori", lists: [{ path: ["roster"], collection: "roster", label: "Giocatori" }] },
  fixtures: { id: "fixtures", file: "content/cms/fixtures.json", label: "Calendario Prima squadra", lists: [{ path: ["fixtures"], collection: "fixtures", label: "Partite" }] },
  u21Fixtures: { id: "u21Fixtures", file: "content/cms/u21-fixtures.json", label: "Calendario Under 23", lists: [{ path: ["u21Fixtures"], collection: "u21Fixtures", label: "Partite U23" }] },
  galleryAlbums: { id: "galleryAlbums", file: "content/cms/gallery-albums.json", label: "Gallery", lists: [{ path: ["galleryAlbums"], collection: "galleryAlbums", label: "Album" }] },
  sponsors: { id: "sponsors", file: "content/cms/sponsors.json", label: "Sponsor", lists: [{ path: ["sponsors"], collection: "sponsors", label: "Sponsor" }] },
  sponsorPackages: { id: "sponsorPackages", file: "content/cms/sponsor-packages.json", label: "Pacchetti sponsor", lists: [{ path: ["sponsorPackages"], collection: "sponsorPackages", label: "Pacchetti" }] },
  staff: { id: "staff", file: "content/cms/staff.json", label: "Staff", lists: [{ path: ["staff"], collection: "staff", label: "Staff" }] },
  videos: { id: "videos", file: "content/cms/videos.json", label: "Video", lists: [{ path: ["videos"], collection: "videos", label: "Video" }] },
  clubHistory: {
    id: "clubHistory",
    file: "content/cms/club-history.json",
    label: "Storia del club",
    lists: [{ path: ["clubHistory", "images"], slugFields: ["season"], label: "Immagini storiche" }],
  },
  events: {
    id: "events",
    file: "content/cms/events.json",
    label: "Eventi e CUS Trento League",
    lists: [
      { path: ["events"], collection: "events", label: "Eventi" },
      { path: ["cusTrentoLeague", "teams"], label: "Squadre League" },
      { path: ["cusTrentoLeague", "matches"], label: "Partite League" },
    ],
  },
};

export function isDocumentId(value: string): value is DocumentId {
  return (DOCUMENT_IDS as readonly string[]).includes(value);
}

export function findList(doc: DocumentId, path: readonly string[]): ListDef | undefined {
  return DOCUMENTS[doc].lists.find((l) => l.path.join("/") === path.join("/"));
}

export const ROSTER_ROLES = ["Portiere", "Centrale", "Laterale", "Pivot", "Universale"] as const;
/** "Under 21" is the stored value; the site shows it as Under 23 (publicYouthText). */
export const ROSTER_TEAMS = [
  { value: "Prima squadra", label: "Prima squadra" },
  { value: "Under 21", label: "Under 23" },
] as const;
export const MATCH_STATUSES = ["Da giocare", "Terminata"] as const;
export const COMPETITIONS = ["Campionato", "Coppa"] as const;
export const NEWS_TAGS = ["SporTrentino", "Prima squadra", "Under 23", "Club", "Matchday", "U23", "Analytics"] as const;
export const MEDIA_SEASONS = ["2025/26", "2026/27"] as const;
export const MEDIA_CATEGORIES = [
  { value: "prima squadra", label: "Prima squadra" },
  { value: "under 21", label: "Under 23" },
  { value: "partite", label: "Partite" },
  { value: "interviste", label: "Interviste" },
  { value: "CNU", label: "CNU" },
  { value: "vario", label: "Vario" },
] as const;
export const STAFF_GROUPS = ["Staff tecnico", "Dirigenza"] as const;
export const EVENT_TYPES = ["Torneo", "Selezione"] as const;
/** Players that can be called up for a match (both teams), starters and bench together. */
export const MAX_SQUAD = 12;
export const OWN_GOAL_ID = "autogol";
export const LEAGUE_OWN_GOAL = "Autogol";
