// Zod schemas of the CMS files. They are deliberately tolerant of the data
// already in the repository (every current file must validate, see tests) and
// loose: unknown keys are preserved, never stripped.
import { z } from "zod";
import type { DocumentId } from "./documents";

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME = /^([01]\d|2[0-3])[:.][0-5]\d$/;
/** Relative site path or http(s) URL without characters that could break out of an HTML attribute. */
export const SAFE_URL = /^(\/(?!\/)[^\s"'<>`\\]*|https?:\/\/[^\s"'<>`\\]+)$/i;
/** Plain text must not contain markup: the public site inserts some fields as HTML. */
export const HTML_TAG = /<\s*[a-z!/?]/i;

const text = z.string();
const optText = z.string().optional();
const date = z.string().regex(ISO_DATE, { error: "Data non valida (AAAA-MM-GG)" });
const optDate = z.union([z.literal(""), date]).optional().nullable();
const url = z.union([z.literal(""), z.string().regex(SAFE_URL, { error: "URL non valido" })]);
const optUrl = url.optional().nullable();
const id = z.union([z.string(), z.number()]);
const count = (min: number) => z.coerce.number().int().min(min);
const optScore = z.number().int().min(0).nullable().optional();

const withIds = { id: id.optional(), slug: optText };

// ---- News -------------------------------------------------------------------
const contentBlock = z.looseObject({
  type: z.enum(["paragraph", "image"]).optional(),
  text: optText.nullable(),
  image: optUrl,
  caption: optText.nullable(),
});

export const newsItem = z.looseObject({
  ...withIds,
  title: text.min(1, { error: "Titolo obbligatorio" }),
  category: optText,
  tags: z.array(z.string()).optional().nullable(),
  date,
  author: optText,
  image: optUrl,
  excerpt: optText,
  body: z.union([z.array(z.string()), z.string()]).optional().nullable(),
  contentBlocks: z.array(contentBlock).optional().nullable(),
  pinned: z.boolean().optional(),
});

// ---- Roster -----------------------------------------------------------------
export const rosterItem = z.looseObject({
  ...withIds,
  name: text.min(1, { error: "Nome obbligatorio" }),
  role: z.string(),
  team: z.string(),
  number: z.union([z.number().int(), z.string()]).optional().nullable(),
  birthDate: optDate,
  birthPlace: optText.nullable(),
  faculty: optText.nullable(),
  photo: optUrl,
});

// ---- Matches ----------------------------------------------------------------
const playerRef = z.union([z.string(), z.number()]).transform(String);
const eventBase = { playerId: playerRef };
const goalTimes = z.array(z.looseObject({ time: optText.nullable() })).optional().nullable();

export const matchItem = z.looseObject({
  ...withIds,
  date: optDate,
  time: optText.nullable(),
  home: z.string(),
  away: z.string(),
  venue: optText.nullable(),
  score: optText.nullable(),
  status: optText.nullable(),
  competition: optText.nullable(),
  opponentLogo: optUrl,
  lineup: z
    .looseObject({
      startingFive: z.array(playerRef).optional().nullable(),
      bench: z.array(playerRef).optional().nullable(),
    })
    .optional()
    .nullable(),
  scorerEvents: z
    .array(z.looseObject({ ...eventBase, goals: count(1).optional(), minute: optText.nullable(), goalTimes }))
    .optional()
    .nullable(),
  yellowCardEvents: z.array(z.looseObject({ ...eventBase, cards: count(1).optional() })).optional().nullable(),
  redCardEvents: z.array(z.looseObject({ ...eventBase, cards: count(1).optional() })).optional().nullable(),
  goalkeeperEvents: z
    .array(z.looseObject({ ...eventBase, goalsAgainst: count(0).optional(), appearances: count(0).optional() }))
    .optional()
    .nullable(),
  opponentScorerEvents: z
    .array(z.looseObject({ name: z.string(), goals: count(1).optional(), minute: optText.nullable(), goalTimes }))
    .optional()
    .nullable(),
  opponentLineup: z
    .array(
      z.looseObject({
        number: z.union([z.string(), z.number()]).optional().nullable(),
        surname: z.string(),
        firstName: optText.nullable(),
        goals: count(0).optional().nullable(),
        minute: optText.nullable(),
        goalTimes,
        yellow: z.boolean().optional().nullable(),
        red: z.boolean().optional().nullable(),
      }),
    )
    .optional()
    .nullable(),
});

// ---- Media, sponsors, staff -------------------------------------------------
export const galleryAlbum = z.looseObject({
  ...withIds,
  title: text.min(1, { error: "Titolo obbligatorio" }),
  season: optText,
  categories: z.array(z.string()).optional().nullable(),
  date: optDate,
  cover: optUrl,
  photos: z.array(z.union([url, z.looseObject({})])).optional().nullable(),
});

export const sponsor = z.looseObject({ ...withIds, name: text.min(1, { error: "Nome obbligatorio" }), logo: optUrl, url: optUrl });

export const sponsorPackage = z.looseObject({
  ...withIds,
  name: text.min(1, { error: "Nome obbligatorio" }),
  price: optText,
  visibility: z.array(z.string()).optional().nullable(),
  cta: optText,
});

export const staffMember = z.looseObject({
  ...withIds,
  name: text.min(1, { error: "Nome obbligatorio" }),
  role: z.string(),
  team: optText,
  photo: optUrl,
  bio: optText.nullable(),
});

export const video = z.looseObject({
  ...withIds,
  title: text.min(1, { error: "Titolo obbligatorio" }),
  season: optText,
  categories: z.array(z.string()).optional().nullable(),
  url: z.string().regex(SAFE_URL, { error: "URL video non valido" }),
});

export const clubHistory = z.looseObject({
  title: z.string(),
  paragraphs: z.array(z.string()),
  images: z.array(z.looseObject({ ...withIds, season: z.string(), image: optUrl })).optional().nullable(),
});

// ---- Events and CUS Trento League ---------------------------------------------
export const eventItem = z.looseObject({
  ...withIds,
  title: text.min(1, { error: "Titolo obbligatorio" }),
  type: optText,
  date: optDate,
  time: optText.nullable(),
  venue: optText.nullable(),
  summary: optText,
  details: optText.nullable(),
});

export const leaguePlayer = z.looseObject({
  number: z.union([z.string(), z.number()]).optional().nullable(),
  name: z.string(),
  role: optText.nullable(),
});

export const leagueTeam = z.looseObject({
  id: optText,
  name: text.min(1, { error: "Nome squadra obbligatorio" }),
  logo: optUrl,
  group: z.enum(["A", "B"], { error: "Girone A o B" }),
  players: z.array(z.union([leaguePlayer, z.string()])).optional().nullable(),
});

export const leagueScorer = z.looseObject({ name: z.string(), team: optText, goals: count(1).optional() });

export const leagueMatch = z.looseObject({
  id: optText,
  date: optDate,
  time: optText.nullable(),
  group: z.enum(["A", "B"]).optional().nullable(),
  round: optText.nullable(),
  home: z.string(),
  away: z.string(),
  homeScore: optScore,
  awayScore: optScore,
  status: optText.nullable(),
  scorers: z.array(leagueScorer).optional().nullable(),
});

export const knockoutMatch = z.looseObject({
  name: optText,
  date: optDate,
  time: optText.nullable(),
  team1Score: optScore,
  team2Score: optScore,
  winner: optText.nullable(),
  scorers: z.array(leagueScorer).optional().nullable(),
});

export const leagueRulesSection = z.looseObject({ title: z.string(), paragraphs: z.array(z.string()) });

export const league = z.looseObject({
  title: optText,
  edition: optText,
  sport: optText,
  startDate: optDate,
  endDate: optDate,
  venue: optText.nullable(),
  instagram: optUrl,
  teams: z.array(leagueTeam).optional().nullable(),
  matches: z.array(leagueMatch).optional().nullable(),
  bracket: z
    .looseObject({
      format: optText.nullable(),
      quarterfinals: z.array(knockoutMatch).optional().nullable(),
      semifinals: z.array(knockoutMatch).optional().nullable(),
      final: knockoutMatch.optional().nullable(),
    })
    .optional()
    .nullable(),
  rules: z
    .looseObject({ intro: optText.nullable(), sections: z.array(leagueRulesSection).optional().nullable() })
    .optional()
    .nullable(),
});

// ---- Documents --------------------------------------------------------------
const list = <T extends z.ZodType>(item: T) => z.array(item);

export const DOCUMENT_SCHEMAS: Record<DocumentId, z.ZodType> = {
  news: z.looseObject({ news: list(newsItem) }),
  roster: z.looseObject({ roster: list(rosterItem) }),
  fixtures: z.looseObject({ fixtures: list(matchItem) }),
  u21Fixtures: z.looseObject({ u21Fixtures: list(matchItem) }),
  galleryAlbums: z.looseObject({ galleryAlbums: list(galleryAlbum) }),
  sponsors: z.looseObject({ sponsors: list(sponsor) }),
  sponsorPackages: z.looseObject({ sponsorPackages: list(sponsorPackage) }),
  staff: z.looseObject({ staff: list(staffMember) }),
  videos: z.looseObject({ videos: list(video) }),
  clubHistory: z.looseObject({ clubHistory }),
  events: z.looseObject({ events: list(eventItem), cusTrentoLeague: league }),
};

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateDocument(doc: DocumentId, content: unknown): ValidationIssue[] {
  const result = DOCUMENT_SCHEMAS[doc].safeParse(content);
  if (result.success) return [];
  return result.error.issues.slice(0, 50).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
