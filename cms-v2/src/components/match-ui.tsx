import { Minus, Plus, Trash2, UserPlus, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { SearchPicker, type PickerOption } from "./ui/dialogs";

/** − value + control: large targets, no keyboard needed. */
export function Stepper({ value, onChange, min = 0, max = 99, label, size = "default" }: { value: number | null | undefined; onChange: (v: number) => void; min?: number; max?: number; label: string; size?: "default" | "lg" }) {
  const v = Number.isFinite(Number(value)) && value !== null && value !== undefined ? Number(value) : null;
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
      <Button type="button" variant="outline" size={size === "lg" ? "icon" : "icon-sm"} onClick={() => onChange(Math.max(min, (v ?? min) - 1))} disabled={v !== null && v <= min} aria-label={`${label}: meno`}><Minus /></Button>
      <span className={cn("min-w-10 text-center font-display font-bold tabular", size === "lg" ? "text-4xl" : "text-xl", v === null && "text-muted/50 text-base font-sans font-medium")} aria-live="polite">{v ?? "vuoto"}</span>
      <Button type="button" variant="outline" size={size === "lg" ? "icon" : "icon-sm"} onClick={() => onChange(Math.min(max, v === null ? Math.max(min, 0) : v + 1))} disabled={v !== null && v >= max} aria-label={`${label}: più`}><Plus /></Button>
    </div>
  );
}

export interface PlayerChoice { id: string; name: string; number?: string; detail?: string; group?: string; goalkeeper?: boolean }

export function toOptions(players: PlayerChoice[]): PickerOption[] {
  return players.map((p) => ({ value: p.id, label: p.name, badge: p.number ? `#${p.number}` : undefined, description: p.detail, group: p.group }));
}

/** Chips of selected players with a search picker to add more. */
export function PlayerMultiPicker({ label, value, onChange, players, max, hint, exclude = [] }: { label: string; value: string[]; onChange: (v: string[]) => void; players: PlayerChoice[]; max?: number; hint?: string; exclude?: string[] }) {
  const [open, setOpen] = React.useState(false);
  const byId = new Map(players.map((p) => [p.id, p]));
  const options = toOptions(players.filter((p) => !exclude.includes(p.id) || value.includes(p.id)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-foreground/80">{label}{max ? <span className="ml-1 font-normal text-muted">({value.length}/{max})</span> : <span className="ml-1 font-normal text-muted">({value.length})</span>}</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={!!max && value.length >= max}><UserPlus />Aggiungi</Button>
      </div>
      {value.length ? (
        <ul className="flex flex-col gap-1.5">
          {value.map((id) => {
            const p = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
                <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-surface-2 px-1 font-display font-bold tabular">{p?.number ?? "?"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p?.name ?? id}</span>
                  {(p?.detail || !p) && <span className={cn("block truncate text-xs", p ? "text-muted" : "text-danger")}>{p ? p.detail : "Giocatore non trovato in rosa"}</span>}
                </span>
                <button type="button" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Rimuovi ${p?.name ?? id}`}><X className="size-4" /></button>
              </li>
            );
          })}
        </ul>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted">Nessun giocatore selezionato · tocca per aggiungere</button>
      )}
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      <SearchPicker open={open} onOpenChange={setOpen} title={label} options={options} value={value} multiple onChange={(v) => onChange(max ? v.slice(0, max) : v)} placeholder="Nome o numero…" />
    </div>
  );
}

/** Single player button that opens the picker. */
export function PlayerButton({ value, onChange, players, title, allowCustom, extraOptions = [] }: { value: string; onChange: (v: string) => void; players: PlayerChoice[]; title: string; allowCustom?: boolean; extraOptions?: PickerOption[] }) {
  const [open, setOpen] = React.useState(false);
  const p = players.find((x) => x.id === value);
  const extra = extraOptions.find((o) => o.value === value);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-left">
        {p?.number && <span className="font-display font-bold text-muted tabular">#{p.number}</span>}
        <span className={cn("truncate", !value && "text-muted")}>{p?.name ?? extra?.label ?? (value || "Scegli giocatore…")}</span>
      </button>
      <SearchPicker open={open} onOpenChange={setOpen} title={title} options={[...extraOptions, ...toOptions(players)]} value={value ? [value] : []} onChange={(v) => onChange(v[0] ?? "")} allowCustom={allowCustom} customLabel="Inserisci" />
    </>
  );
}

export function RowCard({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2/60 p-3">
      {children}
      <Button type="button" variant="ghost" size="sm" className="self-end text-danger" onClick={onRemove}><Trash2 />Rimuovi</Button>
    </div>
  );
}

/** Goal time inputs, one per goal (e.g. 13’12” pt). */
export function GoalTimes({ goals, times, onChange }: { goals: number; times: string[]; onChange: (t: string[]) => void }) {
  const n = Math.max(1, goals);
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: n }).map((_, i) => (
        <input
          key={i}
          value={times[i] ?? ""}
          onChange={(e) => {
            const next = [...times];
            next[i] = e.target.value;
            onChange(next.slice(0, n));
          }}
          placeholder={`Gol ${i + 1}: es. 13’12” pt`}
          className="h-11 rounded-xl border border-border bg-surface px-3 focus:border-primary focus:outline-none"
          aria-label={`Tempo del gol ${i + 1}`}
        />
      ))}
    </div>
  );
}
