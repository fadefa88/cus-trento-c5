import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Camera, Crop, ImageIcon, Images, Loader2, Plus, Trash2, X } from "lucide-react";
import * as React from "react";
import Cropper from "react-easy-crop";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PROFILES, prepareImage, type CropArea, type ProfileName } from "@/lib/image";
import { cn, imageUrl, markPendingUpload, matchesSearch } from "@/lib/utils";
import { Button } from "./ui/button";
import { Field, Input, NativeSelect, Textarea } from "./ui/primitives";

type Common = { label?: React.ReactNode; hint?: React.ReactNode; error?: string; required?: boolean; className?: string };

let idCounter = 0;
function useFieldId() {
  return React.useMemo(() => `f${++idCounter}`, []);
}

export function TextField({ value, onChange, placeholder, type = "text", inputMode, autoComplete = "off", ...c }: Common & { value: unknown; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string }) {
  const id = useFieldId();
  return (
    <Field {...c} htmlFor={id}>
      <Input id={id} type={type} inputMode={inputMode} value={String(value ?? "")} placeholder={placeholder} autoComplete={autoComplete} aria-invalid={!!c.error} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function TextAreaField({ value, onChange, rows = 4, placeholder, ...c }: Common & { value: unknown; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  const id = useFieldId();
  return (
    <Field {...c} htmlFor={id}>
      <Textarea id={id} rows={rows} value={String(value ?? "")} placeholder={placeholder} aria-invalid={!!c.error} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function DateField({ value, onChange, ...c }: Common & { value: unknown; onChange: (v: string) => void }) {
  const id = useFieldId();
  return (
    <Field {...c} htmlFor={id}>
      <Input id={id} type="date" value={String(value ?? "").slice(0, 10)} aria-invalid={!!c.error} onChange={(e) => onChange(e.target.value)} className="appearance-none" />
    </Field>
  );
}

export function TimeField({ value, onChange, ...c }: Common & { value: unknown; onChange: (v: string) => void }) {
  const id = useFieldId();
  const v = String(value ?? "").replace(".", ":");
  return (
    <Field {...c} htmlFor={id}>
      <Input id={id} type="time" step={300} value={/^\d{2}:\d{2}$/.test(v) ? v : ""} onChange={(e) => onChange(e.target.value)} className="appearance-none" />
    </Field>
  );
}

export function NumberField({ value, onChange, min, max, ...c }: Common & { value: unknown; onChange: (v: number | null) => void; min?: number; max?: number }) {
  const id = useFieldId();
  return (
    <Field {...c} htmlFor={id}>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value === null || value === undefined ? "" : String(value)}
        aria-invalid={!!c.error}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          if (raw === "") return onChange(null);
          let n = parseInt(raw, 10);
          if (max !== undefined) n = Math.min(n, max);
          if (min !== undefined) n = Math.max(n, min);
          onChange(n);
        }}
      />
    </Field>
  );
}

export function SelectField({ value, onChange, options, placeholder, ...c }: Common & { value: unknown; onChange: (v: string) => void; options: ReadonlyArray<string | { value: string; label: string }>; placeholder?: string }) {
  const id = useFieldId();
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const current = String(value ?? "");
  return (
    <Field {...c} htmlFor={id}>
      <NativeSelect id={id} value={current} aria-invalid={!!c.error} onChange={(e) => onChange(e.target.value)}>
        {(placeholder || !opts.some((o) => o.value === current)) && <option value="">{placeholder || "Seleziona…"}</option>}
        {current && !opts.some((o) => o.value === current) && <option value={current}>{current} (valore esistente)</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </NativeSelect>
    </Field>
  );
}

export function ChipsField({ value, onChange, options, ...c }: Common & { value: unknown; onChange: (v: string[]) => void; options: ReadonlyArray<string | { value: string; label: string }> }) {
  const selected = Array.isArray(value) ? value.map(String) : [];
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const extra = selected.filter((s) => !opts.some((o) => o.value === s)).map((s) => ({ value: s, label: s }));
  return (
    <Field {...c}>
      <div className="flex flex-wrap gap-2">
        {[...opts, ...extra].map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((s) => s !== o.value) : [...selected, o.value])}
              className={cn("h-10 rounded-full border px-4 text-sm font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground")}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

export function ToggleRow({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left">
      <span className="flex-1">
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
      <span className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors", checked ? "bg-success" : "bg-border")}>
        <span className={cn("block size-6 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

/** Ordered list of strings (paragraphs, bullet points) with touch-friendly reordering. */
export function StringListField({ value, onChange, multiline, addLabel = "Aggiungi", placeholder, ...c }: Common & { value: unknown; onChange: (v: string[]) => void; multiline?: boolean; addLabel?: string; placeholder?: string }) {
  const items = Array.isArray(value) ? value.map((v) => String(v ?? "")) : [];
  const update = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v : x)));
  const move = (i: number, d: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <Field {...c}>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              {multiline ? (
                <Textarea rows={3} value={item} placeholder={placeholder} onChange={(e) => update(i, e.target.value)} aria-label={`Elemento ${i + 1}`} />
              ) : (
                <Input value={item} placeholder={placeholder} onChange={(e) => update(i, e.target.value)} aria-label={`Elemento ${i + 1}`} />
              )}
            </div>
            <div className="flex flex-col">
              <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Sposta su"><ArrowUp /></Button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Sposta giù"><ArrowDown /></Button>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" className="text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Rimuovi"><Trash2 /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => onChange([...items, ""])} className="self-start"><Plus />{addLabel}</Button>
      </div>
    </Field>
  );
}

// ---- Images ------------------------------------------------------------------

export function useUpload() {
  const [busy, setBusy] = React.useState(false);
  const upload = async (file: File, profile: ProfileName, crop?: CropArea | null) => {
    setBusy(true);
    try {
      const prepared = await prepareImage(file, PROFILES[profile], crop);
      const res = await api.upload([prepared]);
      markPendingUpload(res.files[0].path);
      return res.files[0].path;
    } finally {
      setBusy(false);
    }
  };
  /** Several photos, prepared one by one and sent in batches (one commit per batch). */
  const uploadMany = async (files: File[], profile: ProfileName, onProgress: (text: string) => void) => {
    setBusy(true);
    const paths: string[] = [];
    try {
      let batch: Array<{ blob: Blob; name: string }> = [];
      let size = 0;
      const flush = async () => {
        if (!batch.length) return;
        onProgress(`Invio di ${batch.length} foto…`);
        const res = await api.upload(batch);
        for (const f of res.files) {
          markPendingUpload(f.path);
          paths.push(f.path);
        }
        batch = [];
        size = 0;
      };
      for (const [i, file] of files.entries()) {
        onProgress(`Preparo ${i + 1} di ${files.length}`);
        const prepared = await prepareImage(file, PROFILES[profile]);
        if (batch.length >= 10 || size + prepared.blob.size > 20 * 1024 * 1024) await flush();
        batch.push(prepared);
        size += prepared.blob.size;
      }
      await flush();
      return paths;
    } finally {
      setBusy(false);
    }
  };
  return { upload, uploadMany, busy };
}

function CropDialog({ file, aspect, onCancel, onConfirm }: { file: File | null; aspect: number; onCancel: () => void; onConfirm: (crop: CropArea) => void }) {
  const [url, setUrl] = React.useState("");
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [area, setArea] = React.useState<CropArea | null>(null);
  React.useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <DialogPrimitive.Root open={!!file} onOpenChange={(o) => !o && onCancel()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content aria-describedby={undefined} className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
          <div className="pt-safe flex h-14 items-center justify-between px-2">
            <Button variant="ghost" className="text-white hover:bg-white/10" onClick={onCancel}>Annulla</Button>
            <DialogPrimitive.Title className="font-display text-lg font-bold">Ritaglia</DialogPrimitive.Title>
            <Button onClick={() => area && onConfirm(area)}>Usa foto</Button>
          </div>
          <div className="relative flex-1">{url && <Cropper image={url} crop={crop} zoom={zoom} aspect={aspect} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, px) => setArea(px)} />}</div>
          <div className="pb-safe px-6 py-4">
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-[#dc2626]" aria-label="Zoom" />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function MediaLibraryDialog({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (o: boolean) => void; onSelect: (path: string) => void }) {
  const [query, setQuery] = React.useState("");
  const media = useQuery({ queryKey: ["media"], queryFn: () => api.media(), enabled: open, staleTime: 30_000 });
  const files = (media.data?.files || []).filter((f) => matchesSearch(query, f.name)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[55] bg-black/40" />
        <DialogPrimitive.Content aria-describedby={undefined} className="fixed inset-0 z-[56] flex flex-col bg-background sm:inset-[6vh_auto_auto_50%] sm:h-[80vh] sm:w-[720px] sm:-translate-x-1/2 sm:rounded-3xl sm:border sm:border-border">
          <div className="pt-safe flex h-14 items-center gap-2 border-b border-border px-2">
            <DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label="Chiudi"><X /></Button></DialogPrimitive.Close>
            <DialogPrimitive.Title className="flex-1 font-display text-xl font-bold">Libreria immagini</DialogPrimitive.Title>
          </div>
          <div className="p-3"><Input placeholder="Cerca per nome file…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="grid flex-1 auto-rows-max grid-cols-3 gap-2 overflow-y-auto p-3 sm:grid-cols-4">
            {media.isLoading && <p className="col-span-full py-10 text-center text-muted"><Loader2 className="mx-auto animate-spin" /></p>}
            {files.map((f) => (
              <button key={f.path} type="button" onClick={() => { onSelect(f.path); onOpenChange(false); }} className="group overflow-hidden rounded-xl border border-border bg-surface text-left">
                <img src={imageUrl(f.path)} alt="" loading="lazy" className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
                <span className="block truncate px-2 py-1 text-[11px] text-muted">{f.name}</span>
              </button>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ImageField({ value, onChange, profile = "free", crop: allowCrop = true, ...c }: Common & { value: unknown; onChange: (v: string) => void; profile?: ProfileName; crop?: boolean }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState<File | null>(null);
  const [library, setLibrary] = React.useState(false);
  const { upload, busy } = useUpload();
  const p = PROFILES[profile] as { aspect?: number; label: string };
  const current = String(value ?? "");
  const doUpload = async (file: File, area?: CropArea | null) => {
    try {
      onChange(await upload(file, profile, area));
      toast.success("Immagine caricata");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Caricamento non riuscito");
    }
  };
  return (
    <Field {...c}>
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
        <div className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2", p.aspect === 1 ? "size-20" : p.aspect ? "h-24 w-[76px]" : "h-20 w-28")}>
          {current ? <img src={imageUrl(current)} alt="" className={cn("size-full", profile === "logo" ? "object-contain p-1" : "object-cover")} /> : <ImageIcon className="size-6 text-muted" />}
          {busy && <span className="absolute inset-0 grid place-items-center bg-black/50 text-white"><Loader2 className="animate-spin" /></span>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}><Camera />{current ? "Sostituisci" : "Carica"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLibrary(true)} disabled={busy}><Images />Libreria</Button>
            {current && <Button type="button" size="sm" variant="ghost" className="text-danger" onClick={() => onChange("")} aria-label="Rimuovi immagine"><Trash2 /></Button>}
          </div>
          {current && <p className="truncate text-xs text-muted">{current}</p>}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (allowCrop && p.aspect) setPending(f);
          else void doUpload(f);
        }}
      />
      <CropDialog file={pending} aspect={p.aspect || 1} onCancel={() => setPending(null)} onConfirm={(area) => { const f = pending!; setPending(null); void doUpload(f, area); }} />
      <MediaLibraryDialog open={library} onOpenChange={setLibrary} onSelect={onChange} />
      {allowCrop && p.aspect ? <p className="flex items-center gap-1 text-xs text-muted"><Crop className="size-3" />{p.label}: ritaglio {p.aspect === 1 ? "quadrato" : "verticale 4:5"}</p> : null}
    </Field>
  );
}

/** Multiple images (gallery album). */
export function ImageListField({ value, onChange, ...c }: Common & { value: unknown; onChange: (v: string[]) => void }) {
  const items = (Array.isArray(value) ? value : []).map((v) => (typeof v === "string" ? v : String((v as Record<string, unknown>)?.u ?? (v as Record<string, unknown>)?.url ?? "")));
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [library, setLibrary] = React.useState(false);
  const [progress, setProgress] = React.useState<string | null>(null);
  const { uploadMany } = useUpload();
  return (
    <Field {...c}>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {items.map((src, i) => (
          <div key={src + i} className="group relative overflow-hidden rounded-xl border border-border bg-surface-2">
            <img src={imageUrl(src)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-black/70 to-transparent p-1">
              <button type="button" className="grid size-8 place-items-center rounded-lg text-white disabled:opacity-30" disabled={i === 0} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }} aria-label="Sposta prima"><ArrowUp className="size-4 -rotate-90" /></button>
              <button type="button" className="grid size-8 place-items-center rounded-lg text-white" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Rimuovi"><Trash2 className="size-4" /></button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={!!progress} className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-border text-muted">
          {progress ? <span className="text-center text-xs"><Loader2 className="mx-auto mb-1 animate-spin" />{progress}</span> : <span className="text-center text-xs"><Plus className="mx-auto mb-1" />Aggiungi foto</span>}
        </button>
      </div>
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setLibrary(true)}><Images />Scegli dalla libreria</Button>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={async (e) => {
          const files = [...(e.target.files || [])];
          e.target.value = "";
          let added: string[] = [];
          try {
            added = await uploadMany(files, "gallery", setProgress);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Caricamento non riuscito");
          }
          setProgress(null);
          if (added.length) {
            onChange([...items, ...added]);
            toast.success(`${added.length} foto caricate`);
          }
        }}
      />
      <MediaLibraryDialog open={library} onOpenChange={setLibrary} onSelect={(p) => onChange([...items, p])} />
    </Field>
  );
}
