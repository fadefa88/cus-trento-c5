import { Users } from "lucide-react";
import { ROSTER_ROLES, ROSTER_TEAMS } from "@shared/documents";
import { CollectionPage, type CollectionConfig, type Item } from "@/components/collection";
import { DateField, ImageField, NumberField, SelectField, TextField } from "@/components/fields";
import { Badge } from "@/components/ui/primitives";

const str = (v: unknown) => String(v ?? "");
export const teamLabel = (team: unknown) => (str(team).toLowerCase().includes("under") ? "Under 23" : "Prima squadra");

export const rosterConfig: CollectionConfig<Item> = {
  doc: "roster",
  list: ["roster"],
  title: "Rose giocatori",
  eyebrow: "Sport",
  description: "Presenze, gol, cartellini e gol subiti si calcolano da soli dalle partite terminate.",
  icon: Users,
  singular: "giocatore",
  collection: "roster",
  itemTitle: (i) => str(i.name),
  itemSubtitle: (i) => `#${str(i.number)} · ${str(i.role)}`,
  badges: (i) => <Badge tone={teamLabel(i.team) === "Under 23" ? "warning" : "primary"}>{teamLabel(i.team)}</Badge>,
  thumb: (i) => i.photo,
  thumbShape: "portrait",
  search: (i) => [i.name, i.number, i.role, teamLabel(i.team), i.faculty],
  sort: (a, b) => (teamLabel(a.team) === teamLabel(b.team) ? Number(a.number) - Number(b.number) : teamLabel(a.team) === "Prima squadra" ? -1 : 1),
  filters: [
    { id: "prima", label: "Prima squadra", test: (i) => teamLabel(i.team) === "Prima squadra" },
    { id: "u23", label: "Under 23", test: (i) => teamLabel(i.team) === "Under 23" },
    { id: "all", label: "Tutti", test: () => true },
  ],
  editor: {
    title: (v) => str(v.name) || "Nuovo giocatore",
    create: () => ({ name: "", role: "Universale", team: "Prima squadra", number: null, birthDate: "", birthPlace: "", faculty: "", photo: "" }),
    summary: (v, isNew) => `${isNew ? "Aggiungi" : "Aggiorna"} giocatore: ${str(v.name)}`,
    deleteLabel: "Elimina giocatore",
    children: (v, set) => (
      <>
        <ImageField label="Foto" value={v.photo} onChange={(x) => set("photo", x)} profile="people" />
        <TextField label="Nome" required value={v.name} onChange={(x) => set("name", x)} hint="Cognome Nome, come nelle altre schede (es. Rossi Mario)." autoComplete="off" />
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Numero" required value={v.number} onChange={(x) => set("number", x)} min={0} max={99} />
          <SelectField label="Ruolo" required value={v.role} onChange={(x) => set("role", x)} options={ROSTER_ROLES} />
        </div>
        <SelectField label="Squadra" required value={v.team} onChange={(x) => set("team", x)} options={ROSTER_TEAMS} />
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Data di nascita" value={v.birthDate} onChange={(x) => set("birthDate", x)} />
          <TextField label="Luogo di nascita" value={v.birthPlace} onChange={(x) => set("birthPlace", x)} />
        </div>
        <TextField label="Facoltà universitaria" value={v.faculty} onChange={(x) => set("faculty", x)} />
      </>
    ),
  },
};

export const RosterPage = () => <CollectionPage config={rosterConfig} />;
