// Editorial collections built on the generic CollectionPage. Fields mirror
// admin/config.yml one to one; fields not shown here are preserved on save.
import { Film, Handshake, Images, Package, Sparkles, UserRound } from "lucide-react";
import { EVENT_TYPES, MEDIA_CATEGORIES, MEDIA_SEASONS, STAFF_GROUPS } from "@shared/documents";
import { SAFE_URL } from "@shared/schemas";
import { CollectionPage, type CollectionConfig, type Item } from "@/components/collection";
import { ChipsField, DateField, ImageField, ImageListField, SelectField, StringListField, TextAreaField, TextField, TimeField } from "@/components/fields";
import { FormSection } from "@/components/editor";
import { Badge } from "@/components/ui/primitives";
import { formatDate, todayIso } from "@/lib/utils";

const str = (v: unknown) => String(v ?? "");
const categoryLabel = (v: string) => MEDIA_CATEGORIES.find((c) => c.value === v)?.label || v;

function youtubeId(url: string) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/);
  return m ? m[1] : null;
}

export const staffConfig: CollectionConfig<Item> = {
  doc: "staff",
  list: ["staff"],
  title: "Staff",
  eyebrow: "Club",
  icon: UserRound,
  singular: "membro dello staff",
  collection: "staff",
  reorderable: true,
  itemTitle: (i) => str(i.name),
  itemSubtitle: (i) => [i.role, i.team].filter(Boolean).join(" · "),
  thumb: (i) => i.photo,
  thumbShape: "portrait",
  search: (i) => [i.name, i.role, i.team],
  filters: [{ id: "all", label: "Tutti", test: () => true }, ...STAFF_GROUPS.map((g) => ({ id: g, label: g, test: (i: Item) => i.team === g }))],
  editor: {
    title: (v) => str(v.name) || "Nuovo membro",
    create: () => ({ name: "", role: "", team: "Staff tecnico", photo: "", bio: "" }),
    summary: (v, isNew) => `${isNew ? "Aggiungi" : "Aggiorna"} staff: ${str(v.name)}`,
    children: (v, set) => (
      <>
        <ImageField label="Foto" value={v.photo} onChange={(x) => set("photo", x)} profile="people" />
        <TextField label="Nome" required value={v.name} onChange={(x) => set("name", x)} hint="Formato usato sul sito: Cognome Nome." />
        <TextField label="Ruolo" required value={v.role} onChange={(x) => set("role", x)} placeholder="Allenatore, Preparatore atletico…" />
        <SelectField label="Gruppo staff" value={v.team} onChange={(x) => set("team", x)} options={STAFF_GROUPS} />
        <TextAreaField label="Bio" value={v.bio} onChange={(x) => set("bio", x)} rows={5} />
      </>
    ),
  },
};

export const sponsorsConfig: CollectionConfig<Item> = {
  doc: "sponsors",
  list: ["sponsors"],
  title: "Sponsor e partner",
  eyebrow: "Club",
  icon: Handshake,
  singular: "sponsor",
  collection: "sponsors",
  reorderable: true,
  emptyText: "Gli sponsor aggiunti qui compaiono nella pagina Partner.",
  itemTitle: (i) => str(i.name),
  itemSubtitle: (i) => str(i.url).replace(/^https?:\/\//, ""),
  thumb: (i) => i.logo,
  thumbShape: "logo",
  search: (i) => [i.name, i.url],
  editor: {
    title: (v) => str(v.name) || "Nuovo sponsor",
    create: () => ({ name: "", logo: "", url: "" }),
    summary: (v, isNew) => `${isNew ? "Aggiungi" : "Aggiorna"} sponsor: ${str(v.name)}`,
    children: (v, set) => (
      <>
        <ImageField label="Logo" value={v.logo} onChange={(x) => set("logo", x)} profile="logo" hint="PNG o WebP con sfondo trasparente. Gli SVG non sono accettati per sicurezza." />
        <TextField label="Nome" required value={v.name} onChange={(x) => set("name", x)} />
        <TextField label="Sito web" type="url" inputMode="url" value={v.url} onChange={(x) => set("url", x.trim())} placeholder="https://" error={v.url && !SAFE_URL.test(str(v.url)) ? "Inserisci un indirizzo che inizia con https://" : undefined} />
      </>
    ),
  },
};

export const packagesConfig: CollectionConfig<Item> = {
  doc: "sponsorPackages",
  list: ["sponsorPackages"],
  title: "Pacchetti sponsor",
  eyebrow: "Club",
  description: "Le proposte mostrate nella pagina Diventa partner.",
  icon: Package,
  singular: "pacchetto",
  collection: "sponsorPackages",
  reorderable: true,
  itemTitle: (i) => str(i.name),
  itemSubtitle: (i) => `${str(i.price) || "Prezzo da definire"} · ${(Array.isArray(i.visibility) ? i.visibility.length : 0)} voci`,
  search: (i) => [i.name, i.price, i.cta],
  editor: {
    title: (v) => str(v.name) || "Nuovo pacchetto",
    create: () => ({ name: "", price: "", visibility: [""], cta: "" }),
    summary: (v, isNew) => `${isNew ? "Aggiungi" : "Aggiorna"} pacchetto: ${str(v.name)}`,
    serialize: (v) => ({ ...v, visibility: (Array.isArray(v.visibility) ? v.visibility : []).map((x) => String(x).trim()).filter(Boolean) }),
    children: (v, set) => (
      <>
        <TextField label="Nome" required value={v.name} onChange={(x) => set("name", x)} />
        <TextField label="Prezzo" value={v.price} onChange={(x) => set("price", x)} placeholder="Da definire" />
        <StringListField label="Cosa include (visibilità)" value={v.visibility} onChange={(x) => set("visibility", x)} addLabel="Aggiungi voce" />
        <TextField label="Testo del pulsante" value={v.cta} onChange={(x) => set("cta", x)} placeholder="Richiedi proposta" />
      </>
    ),
  },
};

export const videosConfig: CollectionConfig<Item> = {
  doc: "videos",
  list: ["videos"],
  title: "Video",
  eyebrow: "Media",
  icon: Film,
  singular: "video",
  collection: "videos",
  reorderable: true,
  itemTitle: (i) => str(i.title),
  itemSubtitle: (i) => [i.season, ...(Array.isArray(i.categories) ? i.categories.map((c) => categoryLabel(String(c))) : [])].filter(Boolean).join(" · "),
  thumb: (i) => {
    const id = youtubeId(str(i.url));
    return i.thumb || (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : "");
  },
  thumbShape: "wide",
  search: (i) => [i.title, i.season, i.categories],
  filters: [{ id: "all", label: "Tutti", test: () => true }, ...MEDIA_SEASONS.map((s) => ({ id: s, label: s, test: (i: Item) => i.season === s }))],
  editor: {
    title: (v) => str(v.title) || "Nuovo video",
    create: () => ({ title: "", season: MEDIA_SEASONS[MEDIA_SEASONS.length - 1], categories: [], url: "" }),
    summary: (v, isNew) => `${isNew ? "Aggiungi" : "Aggiorna"} video: ${str(v.title)}`,
    children: (v, set) => {
      const id = youtubeId(str(v.url));
      return (
        <>
          <TextField label="Link del video" required type="url" inputMode="url" value={v.url} onChange={(x) => set("url", x.trim())} placeholder="https://www.youtube.com/watch?v=…" error={v.url && !SAFE_URL.test(str(v.url)) ? "Link non valido" : undefined} />
          {id && <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="Anteprima" className="aspect-video w-full rounded-2xl object-cover" />}
          <TextField label="Titolo" required value={v.title} onChange={(x) => set("title", x)} />
          <SelectField label="Stagione" value={v.season} onChange={(x) => set("season", x)} options={MEDIA_SEASONS} />
          <ChipsField label="Categorie" value={v.categories} onChange={(x) => set("categories", x)} options={MEDIA_CATEGORIES} hint="Senza categorie il video compare in “tutte”." />
        </>
      );
    },
  },
};

export const galleryConfig: CollectionConfig<Item> = {
  doc: "galleryAlbums",
  list: ["galleryAlbums"],
  title: "Gallery",
  eyebrow: "Media",
  icon: Images,
  singular: "album",
  collection: "galleryAlbums",
  reorderable: true,
  itemTitle: (i) => str(i.title),
  itemSubtitle: (i) => `${formatDate(i.date)} · ${Array.isArray(i.photos) ? i.photos.length : 0} foto`,
  thumb: (i) => i.cover || (Array.isArray(i.photos) ? i.photos[0] : ""),
  thumbShape: "wide",
  badges: (i) => (Array.isArray(i.categories) ? i.categories.map((c) => <Badge key={String(c)}>{categoryLabel(String(c))}</Badge>) : null),
  search: (i) => [i.title, i.season, i.categories],
  editor: {
    title: (v) => str(v.title) || "Nuovo album",
    create: () => ({ title: "", season: MEDIA_SEASONS[MEDIA_SEASONS.length - 1], categories: [], date: todayIso(), cover: "", photos: [] }),
    summary: (v, isNew) => `${isNew ? "Crea" : "Aggiorna"} album: ${str(v.title)}`,
    wide: true,
    children: (v, set) => (
      <>
        <TextField label="Titolo" required value={v.title} onChange={(x) => set("title", x)} />
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Data" value={v.date} onChange={(x) => set("date", x)} />
          <SelectField label="Stagione" value={v.season} onChange={(x) => set("season", x)} options={MEDIA_SEASONS} />
        </div>
        <ChipsField label="Categorie" value={v.categories} onChange={(x) => set("categories", x)} options={MEDIA_CATEGORIES} />
        <ImageField label="Copertina" value={v.cover} onChange={(x) => set("cover", x)} profile="gallery" hint="Se vuota viene usata la prima foto." />
        <ImageListField label="Foto dell'album" value={v.photos} onChange={(x) => set("photos", x)} hint="Puoi selezionare più foto insieme dal rullino." />
      </>
    ),
  },
};

export const eventsConfig: CollectionConfig<Item> = {
  doc: "events",
  list: ["events"],
  title: "Eventi",
  eyebrow: "Eventi",
  description: "Tornei, selezioni e open day. La CUS Trento League ha una sezione dedicata.",
  icon: Sparkles,
  singular: "evento",
  collection: "events",
  itemTitle: (i) => str(i.title),
  itemSubtitle: (i) => [formatDate(i.date, true), i.time, i.venue].filter(Boolean).join(" · "),
  badges: (i) => <Badge tone={i.type === "Torneo" ? "primary" : "neutral"}>{str(i.type) || "Evento"}</Badge>,
  search: (i) => [i.title, i.type, i.venue, i.summary],
  sort: (a, b) => str(b.date).localeCompare(str(a.date)),
  filters: [
    { id: "all", label: "Tutti", test: () => true },
    { id: "next", label: "In programma", test: (i) => str(i.date) >= todayIso() },
    { id: "past", label: "Archivio", test: (i) => !!i.date && str(i.date) < todayIso() },
  ],
  editor: {
    title: (v) => str(v.title) || "Nuovo evento",
    create: () => ({ title: "", type: "Torneo", date: todayIso(), time: "", venue: "", summary: "", details: "" }),
    summary: (v, isNew) => `${isNew ? "Aggiungi" : "Aggiorna"} evento: ${str(v.title)}`,
    children: (v, set) => (
      <>
        <TextField label="Titolo" required value={v.title} onChange={(x) => set("title", x)} />
        <SelectField label="Tipologia" value={v.type} onChange={(x) => set("type", x)} options={EVENT_TYPES} />
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Data" required value={v.date} onChange={(x) => set("date", x)} />
          <TimeField label="Ora" value={v.time} onChange={(x) => set("time", x)} />
        </div>
        <TextField label="Luogo" value={v.venue} onChange={(x) => set("venue", x)} />
        <FormSection title="Testi">
          <TextAreaField label="Sommario" required value={v.summary} onChange={(x) => set("summary", x)} rows={3} />
          <TextAreaField label="Dettagli" value={v.details} onChange={(x) => set("details", x)} rows={5} />
        </FormSection>
      </>
    ),
  },
};

export const StaffPage = () => <CollectionPage config={staffConfig} />;
export const SponsorsPage = () => <CollectionPage config={sponsorsConfig} />;
export const PackagesPage = () => <CollectionPage config={packagesConfig} />;
export const VideosPage = () => <CollectionPage config={videosConfig} />;
export const GalleryPage = () => <CollectionPage config={galleryConfig} />;
export const EventsPage = () => <CollectionPage config={eventsConfig} />;
