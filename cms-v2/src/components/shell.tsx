import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays, CloudUpload, ExternalLink, FileClock, Film, Handshake, History, Home, Images, LayoutGrid, Library, Newspaper, Package, Settings, Shield, Sparkles, Trophy, UserRound, Users, X,
} from "lucide-react";
import * as React from "react";
import type { DocumentId } from "@shared/documents";
import { SITE_URL } from "@shared/site";
import { api } from "@/lib/api";
import { useDocumentsSummary, useDraftActions } from "@/lib/docs";
import { href, useRoute } from "@/lib/router";
import { cn, relativeTime } from "@/lib/utils";
import { ErrorBox } from "./editor";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/dialogs";

export interface NavItem { path: string; label: string; icon: React.ComponentType<{ className?: string }>; docs?: DocumentId[] }
export const NAV: Array<{ title: string; items: NavItem[] }> = [
  { title: "Panoramica", items: [{ path: "/", label: "Dashboard", icon: Home }, { path: "/pubblica", label: "Pubblicazione", icon: CloudUpload }] },
  {
    title: "Sport",
    items: [
      { path: "/partite/prima", label: "Prima squadra", icon: CalendarDays, docs: ["fixtures"] },
      { path: "/partite/u23", label: "Under 23", icon: CalendarDays, docs: ["u21Fixtures"] },
      { path: "/rosa", label: "Rose giocatori", icon: Users, docs: ["roster"] },
      { path: "/league", label: "CUS Trento League", icon: Trophy, docs: ["events"] },
    ],
  },
  {
    title: "Editoriale",
    items: [
      { path: "/news", label: "News", icon: Newspaper, docs: ["news"] },
      { path: "/gallery", label: "Gallery", icon: Images, docs: ["galleryAlbums"] },
      { path: "/video", label: "Video", icon: Film, docs: ["videos"] },
      { path: "/eventi", label: "Eventi", icon: Sparkles, docs: ["events"] },
      { path: "/storia", label: "Storia del club", icon: Library, docs: ["clubHistory"] },
    ],
  },
  {
    title: "Club",
    items: [
      { path: "/staff", label: "Staff", icon: UserRound, docs: ["staff"] },
      { path: "/sponsor", label: "Sponsor e partner", icon: Handshake, docs: ["sponsors"] },
      { path: "/pacchetti", label: "Pacchetti sponsor", icon: Package, docs: ["sponsorPackages"] },
    ],
  },
  {
    title: "Sistema",
    items: [
      { path: "/media", label: "Media", icon: Images },
      { path: "/cronologia", label: "Cronologia e ripristino", icon: History },
      { path: "/impostazioni", label: "Impostazioni", icon: Settings },
    ],
  },
];

const TABS: NavItem[] = [
  { path: "/", label: "Home", icon: Home },
  { path: "/partite/prima", label: "Partite", icon: CalendarDays },
  { path: "/league", label: "League", icon: Trophy },
  { path: "/news", label: "News", icon: Newspaper },
];

function isActive(current: string, path: string) {
  return path === "/" ? current === "/" : current === path || current.startsWith(path + "/");
}

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: () => api.session(), staleTime: 5 * 60_000, retry: false });
}

function DraftCount() {
  const docs = useDocumentsSummary();
  const n = (docs.data?.documents || []).filter((d) => d.draft).length;
  if (!n) return null;
  return <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-bold text-white">{n}</span>;
}

function Brand() {
  return (
    <a href="#/" className="flex items-center gap-3 px-2">
      <img src="/admin-v2/icons/icon-192.png" alt="" className="size-10 rounded-xl" />
      <span className="leading-tight">
        <span className="block font-display text-xl font-bold tracking-tight">CUS Trento C5</span>
        <span className="block text-xs text-muted">Pannello di gestione</span>
      </span>
    </a>
  );
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const route = useRoute();
  return (
    <nav className="flex flex-col gap-5" aria-label="Sezioni">
      {NAV.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{group.title}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(route.path, item.path);
              return (
                <li key={item.path}>
                  <a
                    href={href(item.path)}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors", active ? "bg-foreground text-background" : "text-foreground/85 hover:bg-surface-2")}
                  >
                    <item.icon className="size-[18px]" />
                    {item.label}
                    {item.path === "/pubblica" && <DraftCount />}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const route = useRoute();
  const session = useSession();
  const [moreOpen, setMoreOpen] = React.useState(false);
  React.useEffect(() => setMoreOpen(false), [route.path]);
  const moreActive = !TABS.some((t) => isActive(route.path, t.path) && (t.path !== "/" || route.path === "/"));
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-border bg-surface px-3 py-5 lg:flex">
        <Brand />
        <NavLinks />
        <div className="mt-auto rounded-2xl bg-surface-2 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold"><Shield className="size-4 text-success" />{session.data?.name || "…"}</p>
          <p className="truncate text-xs text-muted">{session.data?.email} · {session.data?.role === "admin" ? "Amministratore" : "Redazione"}</p>
          <a href={SITE_URL} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">Apri il sito <ExternalLink className="size-3" /></a>
        </div>
      </aside>
      <div className="min-w-0">
        <main className="pb-tabbar mx-auto w-full max-w-6xl px-4 pt-safe sm:px-6 lg:px-10 lg:pb-12">{children}</main>
      </div>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/90 backdrop-blur-xl lg:hidden" aria-label="Navigazione principale">
        <ul className="grid grid-cols-5">
          {TABS.map((t) => {
            const active = isActive(route.path, t.path) || (t.path === "/partite/prima" && route.path.startsWith("/partite"));
            return (
              <li key={t.path}>
                <a href={href(t.path)} aria-current={active ? "page" : undefined} className={cn("flex h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", active ? "text-primary" : "text-muted")}>
                  <t.icon className="size-6" />
                  {t.label}
                </a>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setMoreOpen(true)} className={cn("relative flex h-[60px] w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", moreActive && !route.path.startsWith("/partite") ? "text-primary" : "text-muted")}>
              <LayoutGrid className="size-6" />Altro
            </button>
          </li>
        </ul>
      </nav>
      <DialogPrimitive.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <DialogPrimitive.Content aria-describedby={undefined} className="pb-safe fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-surface px-3 pt-3 shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" />
            <div className="mb-3 flex items-center justify-between px-2">
              <DialogPrimitive.Title className="font-display text-2xl font-bold">Tutte le sezioni</DialogPrimitive.Title>
              <DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label="Chiudi"><X /></Button></DialogPrimitive.Close>
            </div>
            <div className="pb-4"><NavLinks onNavigate={() => setMoreOpen(false)} /></div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

export function PageHeader({ title, eyebrow, description, actions, children }: { title: string; eyebrow?: string; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="pb-5 pt-5 lg:pt-10">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">{eyebrow}</p>}
          <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-tight lg:text-[44px]">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}

/** Shown on every section whose document has pending draft changes. */
export function DraftBanner({ doc }: { doc: DocumentId }) {
  const docs = useDocumentsSummary();
  const session = useSession();
  const { publish, discard } = useDraftActions(doc);
  const [confirm, setConfirm] = React.useState<null | "publish" | "discard" | "force">(null);
  const info = docs.data?.documents.find((d) => d.doc === doc)?.draft;
  if (!info) return null;
  const conflict = publish.error && (publish.error as { status?: number }).status === 409;
  return (
    <div className="mb-5 rounded-2xl border border-warning/30 bg-warning-soft p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-start gap-3">
          <FileClock className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-semibold text-foreground">Bozza non pubblicata · {info.changes} modific{info.changes === 1 ? "a" : "he"}</p>
            <p className="text-muted">Ultima modifica di {info.updatedBy}, {relativeTime(info.updatedAt)}. Stai vedendo la versione in bozza.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirm("discard")}>Scarta</Button>
          <Button size="sm" onClick={() => setConfirm("publish")} loading={publish.isPending}><CloudUpload />Pubblica bozza</Button>
        </div>
      </div>
      {publish.error && <div className="mt-3"><ErrorBox error={publish.error} /></div>}
      {conflict && session.data?.role === "admin" && <Button size="sm" variant="outline" className="mt-1" onClick={() => setConfirm("force")}>Pubblica comunque la mia versione</Button>}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "discard" ? "Scartare la bozza?" : confirm === "force" ? "Sovrascrivere le modifiche concorrenti?" : "Pubblicare la bozza?"}
        description={confirm === "discard" ? "Le modifiche in bozza andranno perse. La versione pubblicata resta invariata." : confirm === "force" ? "La bozza sostituirà le modifiche fatte da altri sugli stessi elementi. Potrai comunque ripristinarle dalla cronologia." : "Le modifiche diventano visibili sul sito dopo il deploy (circa un minuto)."}
        actions={[
          confirm === "discard"
            ? { label: "Scarta bozza", variant: "destructive", onSelect: () => discard.mutateAsync().then(() => undefined) }
            : { label: confirm === "force" ? "Sovrascrivi e pubblica" : "Pubblica", variant: confirm === "force" ? "destructive" : "default", onSelect: () => publish.mutateAsync(confirm === "force").then(() => undefined).catch(() => undefined) },
        ]}
      />
    </div>
  );
}
