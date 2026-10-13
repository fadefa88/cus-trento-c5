import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CloudUpload, Copy, Eye, FileClock, History, ImagePlus, Loader2, Monitor, Moon, RotateCcw, Shield, Smartphone, Sun } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { DOCUMENTS, DOCUMENT_IDS, type DocumentId } from "@shared/documents";
import { canonicalJson, getAt, isObject } from "@shared/json";
import { useUpload } from "@/components/fields";
import { ErrorBox } from "@/components/editor";
import { DraftBanner, PageHeader, useSession } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Sheet } from "@/components/ui/dialogs";
import { Badge, Card, EmptyState, Input, NativeSelect, SegmentedControl, Skeleton } from "@/components/ui/primitives";
import { api, type HistoryEntry } from "@/lib/api";
import { useDocumentsSummary } from "@/lib/docs";
import { href, navigate, useRoute } from "@/lib/router";
import { useTheme } from "@/lib/theme";
import { formatDateTime, imageUrl, matchesSearch, relativeTime } from "@/lib/utils";

// ---- Publish center -----------------------------------------------------------------
export function PublishPage() {
  const docs = useDocumentsSummary();
  const session = useSession();
  const qc = useQueryClient();
  const drafts = (docs.data?.documents || []).filter((d) => d.draft);
  const [confirmAll, setConfirmAll] = React.useState(false);
  const publishAll = useMutation({
    mutationFn: async () => {
      const failed: string[] = [];
      for (const d of drafts) {
        try {
          await api.publish(d.doc);
        } catch (e) {
          failed.push(`${d.label}: ${e instanceof Error ? e.message : "errore"}`);
        }
      }
      return failed;
    },
    onSettled: () => qc.invalidateQueries(),
    onSuccess: (failed) => (failed.length ? toast.error(`Alcune bozze non sono state pubblicate`, { description: failed.join("\n") }) : toast.success("Tutte le bozze sono state pubblicate")),
  });
  return (
    <>
      <PageHeader title="Pubblicazione" eyebrow="Panoramica" description="Le bozze restano private finché non le pubblichi. Ogni pubblicazione crea una versione che puoi ripristinare." actions={drafts.length > 1 ? <Button onClick={() => setConfirmAll(true)} loading={publishAll.isPending}><CloudUpload />Pubblica tutto</Button> : undefined} />
      {session.data?.previewUrl && drafts.length > 0 && (
        <a href={session.data.previewUrl} target="_blank" rel="noreferrer" className="mb-5 flex items-center gap-3 rounded-2xl border border-border bg-surface p-4">
          <Eye className="size-5 text-primary" />
          <span className="flex-1 text-sm"><b className="block">Anteprima delle bozze</b><span className="text-muted">Il sito con le bozze applicate (si aggiorna in 1-2 minuti dopo ogni salvataggio).</span></span>
        </a>
      )}
      {docs.isLoading ? <Skeleton className="h-40" /> : drafts.length ? (
        <div className="flex flex-col gap-1">
          {drafts.map((d) => (
            <div key={d.doc}>
              <p className="mb-1.5 flex items-center justify-between text-sm font-semibold"><span>{d.label}</span><a className="text-primary" href={href(pathFor(d.doc))}>Apri sezione</a></p>
              <DraftBanner doc={d.doc} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={CheckCircle2} title="Nessuna bozza in sospeso" text="Tutto ciò che hai salvato è già pubblicato." />
      )}
      <ConfirmDialog open={confirmAll} onOpenChange={setConfirmAll} title={`Pubblicare ${drafts.length} bozze?`} description={drafts.map((d) => d.label).join(", ")} actions={[{ label: "Pubblica tutto", onSelect: () => publishAll.mutateAsync().then(() => undefined) }]} />
    </>
  );
}

export function pathFor(doc: DocumentId): string {
  return ({ news: "/news", roster: "/rosa", fixtures: "/partite/prima", u21Fixtures: "/partite/u23", galleryAlbums: "/gallery", sponsors: "/sponsor", sponsorPackages: "/pacchetti", staff: "/staff", videos: "/video", clubHistory: "/storia", events: "/eventi" } as Record<DocumentId, string>)[doc];
}

// ---- Versions and restore -------------------------------------------------------------
type Item = Record<string, unknown>;

function describeDiff(doc: DocumentId, from: Item, to: Item): string[] {
  const lines: string[] = [];
  for (const list of DOCUMENTS[doc].lists) {
    const a = (getAt(from, list.path) as Item[]) || [];
    const b = (getAt(to, list.path) as Item[]) || [];
    const byId = (xs: Item[]) => new Map(xs.filter(isObject).map((x) => [String(x.id ?? canonicalJson(x)), x]));
    const ma = byId(a), mb = byId(b);
    const label = (x: Item) => String(x.title || x.name || (x.home ? `${x.home} – ${x.away}` : "") || x.season || x.id);
    const added = [...mb.keys()].filter((k) => !ma.has(k)).map((k) => label(mb.get(k)!));
    const removed = [...ma.keys()].filter((k) => !mb.has(k)).map((k) => label(ma.get(k)!));
    const changed = [...mb.keys()].filter((k) => ma.has(k) && canonicalJson(ma.get(k)) !== canonicalJson(mb.get(k))).map((k) => label(mb.get(k)!));
    if (added.length) lines.push(`${list.label}: ripristina ${added.length} (${added.slice(0, 4).join(", ")}${added.length > 4 ? "…" : ""})`);
    if (removed.length) lines.push(`${list.label}: rimuove ${removed.length} (${removed.slice(0, 4).join(", ")}${removed.length > 4 ? "…" : ""})`);
    if (changed.length) lines.push(`${list.label}: riporta ${changed.length} alla versione precedente (${changed.slice(0, 4).join(", ")}${changed.length > 4 ? "…" : ""})`);
  }
  if (!lines.length && canonicalJson(from) !== canonicalJson(to)) lines.push("Testi e impostazioni del documento");
  return lines;
}

export function VersionsPage() {
  const route = useRoute();
  const session = useSession();
  const doc = (route.segments[1] as DocumentId) || "fixtures";
  const valid = DOCUMENT_IDS.includes(doc);
  const history = useQuery({ queryKey: ["history", doc], queryFn: () => api.history(doc), enabled: valid });
  const current = useQuery({ queryKey: ["doc", doc], queryFn: () => api.document<Item>(doc), enabled: valid });
  const [selected, setSelected] = React.useState<HistoryEntry | null>(null);
  return (
    <>
      <PageHeader title="Cronologia e ripristino" eyebrow="Sistema" description="Ogni salvataggio pubblicato è una versione. Il ripristino crea una nuova versione: nulla viene cancellato.">
        <NativeSelect value={doc} onChange={(e) => navigate(`/cronologia/${e.target.value}`)} aria-label="Documento">
          {DOCUMENT_IDS.map((d) => <option key={d} value={d}>{DOCUMENTS[d].label}</option>)}
        </NativeSelect>
      </PageHeader>
      {history.error && <ErrorBox error={history.error} />}
      {history.isLoading ? <Skeleton className="h-64" /> : (
        <Card className="divide-y divide-border">
          {(history.data?.history || []).map((h, i) => (
            <button key={h.sha} type="button" onClick={() => setSelected(h)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
              <History className="size-5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{h.title.replace(/^CMS: /, "")}</span>
                <span className="block text-xs text-muted">{h.actor} · {formatDateTime(h.date)} · {h.sha.slice(0, 7)}</span>
              </span>
              {i === 0 ? <Badge tone="success">Attuale</Badge> : h.action === "decap" ? <Badge>Decap</Badge> : h.action === "restore" ? <Badge tone="warning">Ripristino</Badge> : null}
            </button>
          ))}
        </Card>
      )}
      <VersionSheet doc={doc} entry={selected} onClose={() => setSelected(null)} current={current.data?.published} isLatest={selected?.sha === history.data?.history[0]?.sha} canRestore={session.data?.role === "admin"} />
    </>
  );
}

function VersionSheet({ doc, entry, onClose, current, isLatest, canRestore }: { doc: DocumentId; entry: HistoryEntry | null; onClose: () => void; current?: { content: Item; sha: string }; isLatest: boolean; canRestore: boolean }) {
  const qc = useQueryClient();
  const version = useQuery({ queryKey: ["version", doc, entry?.sha], queryFn: () => api.version<Item>(doc, entry!.sha), enabled: !!entry });
  const [confirm, setConfirm] = React.useState(false);
  const restore = useMutation({
    mutationFn: () => api.restore(doc, entry!.sha, current!.sha),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Versione ripristinata", { description: "Il sito si aggiorna in circa un minuto." });
      onClose();
    },
  });
  const diff = version.data && current ? describeDiff(doc, current.content, version.data.content) : [];
  return (
    <Sheet open={!!entry} onOpenChange={(o) => !o && onClose()} title="Versione" subtitle={entry ? `${entry.actor} · ${formatDateTime(entry.date)}` : undefined}
      footer={canRestore && !isLatest ? <Button size="lg" className="w-full" onClick={() => setConfirm(true)} disabled={!version.data || !current || !diff.length} loading={restore.isPending}><RotateCcw />Ripristina questa versione</Button> : undefined}>
      <ErrorBox error={restore.error} />
      {entry && <p className="mb-4 font-semibold">{entry.title.replace(/^CMS: /, "")}</p>}
      {version.isLoading ? <Loader2 className="animate-spin" /> : isLatest ? <p className="text-muted">Questa è la versione pubblicata attualmente.</p> : (
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">Ripristinando questa versione:</p>
          {diff.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{diff.map((d) => <li key={d}>{d}</li>)}</ul> : <p className="text-sm text-muted">Nessuna differenza con la versione attuale.</p>}
        </Card>
      )}
      {!canRestore && !isLatest && <p className="mt-4 text-sm text-muted">Il ripristino è riservato agli amministratori.</p>}
      {entry?.url && <a href={entry.url} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-semibold text-primary">Vedi su GitHub</a>}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Ripristinare questa versione?" description="Viene creata una nuova versione con questi contenuti. Potrai sempre tornare indietro." actions={[{ label: "Ripristina", onSelect: () => restore.mutateAsync().then(() => undefined) }]} />
    </Sheet>
  );
}

// ---- Media ------------------------------------------------------------------------------
export function MediaPage() {
  const qc = useQueryClient();
  const media = useQuery({ queryKey: ["media"], queryFn: () => api.media() });
  const [query, setQuery] = React.useState("");
  const [progress, setProgress] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const { uploadMany } = useUpload();
  const files = (media.data?.files || []).filter((f) => matchesSearch(query, f.name)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="Media" eyebrow="Sistema" description="Immagini caricate in img/uploads. Le nuove immagini sono ottimizzate automaticamente quando vengono pubblicate." actions={<Button onClick={() => fileRef.current?.click()} loading={!!progress} aria-label="Carica immagini"><ImagePlus /><span className="hidden sm:inline">{progress || "Carica"}</span></Button>} />
      <Input className="mb-4" type="search" placeholder="Cerca per nome…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {media.isLoading ? <Skeleton className="h-64" /> : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {files.map((f) => (
            <li key={f.path} className="overflow-hidden rounded-xl border border-border bg-surface">
              <img src={imageUrl(f.path)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              <div className="flex items-center gap-1 p-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{f.name}</span>
                <button type="button" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Copia percorso" onClick={() => navigator.clipboard.writeText(f.path).then(() => toast.success("Percorso copiato"))}><Copy className="size-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" onChange={async (e) => {
        const list = [...(e.target.files || [])];
        e.target.value = "";
        if (!list.length) return;
        try {
          const paths = await uploadMany(list, "free", setProgress);
          toast.success(`${paths.length} immagini caricate`);
          qc.invalidateQueries({ queryKey: ["media"] });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Caricamento non riuscito");
        } finally {
          setProgress(null);
        }
      }} />
    </>
  );
}

// ---- Settings ------------------------------------------------------------------------------
export function SettingsPage() {
  const session = useSession();
  const [theme, setTheme] = useTheme();
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api.audit(), enabled: session.data?.role === "admin" });
  return (
    <>
      <PageHeader title="Impostazioni" eyebrow="Sistema" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="font-display text-xl font-bold">Aspetto</h2>
          <SegmentedControl value={theme} onChange={setTheme} options={[{ value: "light", label: <span className="flex items-center gap-1.5"><Sun className="size-4" />Chiaro</span> }, { value: "dark", label: <span className="flex items-center gap-1.5"><Moon className="size-4" />Scuro</span> }, { value: "system", label: <span className="flex items-center gap-1.5"><Monitor className="size-4" />Auto</span> }]} className="w-full" />
        </Card>
        <Card className="flex flex-col gap-2 p-4 text-sm">
          <h2 className="font-display text-xl font-bold">Account</h2>
          <p className="flex items-center gap-2"><Shield className="size-4 text-success" />Accesso protetto da Cloudflare Access</p>
          <p><span className="text-muted">Utente:</span> {session.data?.name} ({session.data?.email})</p>
          <p><span className="text-muted">Ruolo:</span> {session.data?.role === "admin" ? "Amministratore" : "Redazione"}</p>
          <p><span className="text-muted">Repository:</span> {session.data?.repo}</p>
          <a href="/cdn-cgi/access/logout" className="mt-2 font-semibold text-primary">Esci</a>
        </Card>
        <Card className="flex flex-col gap-2 p-4 text-sm">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold"><Smartphone className="size-5" />Installa su iPhone</h2>
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            <li>Apri questa pagina con Safari.</li>
            <li>Tocca il pulsante Condividi.</li>
            <li>Scegli “Aggiungi alla schermata Home”.</li>
          </ol>
          <p className="text-muted">Il pannello si aprirà a tutto schermo come un'app.</p>
        </Card>
      </div>
      {session.data?.role === "admin" && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-2xl font-bold">Registro attività</h2>
          {audit.data?.entries === null ? (
            <p className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">Il registro dettagliato richiede il binding KV <code>CMS_KV</code>. Le operazioni restano comunque tracciate nei commit (Cronologia).</p>
          ) : (
            <Card className="divide-y divide-border">
              {(audit.data?.entries || []).map((e, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  {e.ok ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <FileClock className="size-4 shrink-0 text-danger" />}
                  <span className="min-w-0 flex-1 truncate"><b>{e.action}</b>{e.doc ? ` · ${e.doc}` : ""}{e.detail ? ` · ${e.detail}` : ""}</span>
                  <span className="hidden truncate text-xs text-muted sm:block">{e.email || "anonimo"}</span>
                  <span className="shrink-0 text-xs text-muted">{relativeTime(e.ts)}</span>
                </div>
              ))}
              {audit.isLoading && <Skeleton className="h-32" />}
            </Card>
          )}
        </section>
      )}
    </>
  );
}
