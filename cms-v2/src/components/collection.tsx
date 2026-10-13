import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, ImageIcon, Plus, Search } from "lucide-react";
import * as React from "react";
import type { DocumentId } from "@shared/documents";
import { getAt } from "@shared/json";
import type { Op } from "@shared/ops";
import { publicUrl } from "@shared/site";
import { useDocument, useSave, type SaveMode } from "@/lib/docs";
import { setQuery, useRoute } from "@/lib/router";
import { cn, imageUrl, matchesSearch } from "@/lib/utils";
import { ErrorBox, ItemEditor, SaveBar, type ItemEditorProps } from "./editor";
import { DraftBanner, PageHeader } from "./shell";
import { Button } from "./ui/button";
import { Card, EmptyState, Input, Skeleton } from "./ui/primitives";

export type Item = Record<string, unknown>;

export interface CollectionConfig<T extends Item> {
  doc: DocumentId;
  list: string[];
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  singular: string;
  itemTitle: (item: T) => string;
  itemSubtitle?: (item: T) => React.ReactNode;
  thumb?: (item: T) => unknown;
  thumbShape?: "square" | "portrait" | "logo" | "wide";
  badges?: (item: T) => React.ReactNode;
  search: (item: T) => unknown[];
  filters?: Array<{ id: string; label: string; test: (item: T) => boolean }>;
  sort?: (a: T, b: T) => number;
  reorderable?: boolean;
  /** site-core collection, for the "view on site" link. */
  collection?: string;
  editor: Omit<ItemEditorProps<T>, "doc" | "list" | "item" | "open" | "onClose" | "hasDraft">;
  emptyText?: string;
  header?: React.ReactNode;
}

const thumbClass = {
  square: "size-14 rounded-xl object-cover",
  portrait: "h-16 w-[52px] rounded-xl object-cover",
  logo: "size-14 rounded-xl object-contain bg-white p-1",
  wide: "h-14 w-20 rounded-xl object-cover",
};

export function CollectionPage<T extends Item>({ config }: { config: CollectionConfig<T> }) {
  const route = useRoute();
  const { content, isLoading, error, hasDraft, refetch } = useDocument(config.doc);
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState(config.filters?.[0]?.id ?? "");
  const [reorder, setReorder] = React.useState<T[] | null>(null);
  const items = ((content ? getAt(content, config.list) : []) as T[] | undefined) || [];
  const editId = route.query.get("edit");
  const editing = editId && editId !== "new" ? items.find((i) => String(i.id) === editId) || null : null;
  const activeFilter = config.filters?.find((f) => f.id === filter);
  const visible = items.filter((i) => (!activeFilter || activeFilter.test(i)) && matchesSearch(search, ...config.search(i)));
  const sorted = config.sort ? [...visible].sort(config.sort) : visible;

  return (
    <>
      <PageHeader
        title={config.title}
        eyebrow={config.eyebrow}
        description={config.description}
        actions={
          <>
            {config.reorderable && items.length > 1 && !reorder && <Button variant="outline" size="icon" aria-label="Riordina" onClick={() => setReorder(items)}><ArrowUpDown /></Button>}
            <Button onClick={() => setQuery({ edit: "new" })} className="hidden sm:inline-flex"><Plus />Nuovo</Button>
          </>
        }
      />
      <DraftBanner doc={config.doc} />
      {config.header}
      {error ? <ErrorBox error={error} onReload={() => refetch()} /> : null}
      {reorder ? (
        <ReorderList config={config} items={reorder} original={items} onChange={setReorder} onDone={() => setReorder(null)} />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Cerca ${config.title.toLowerCase()}…`} className="pl-10" type="search" enterKeyHint="search" />
            </div>
            {config.filters && (
              <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                {config.filters.map((f) => (
                  <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={cn("h-10 shrink-0 rounded-full border px-4 text-sm font-semibold", filter === f.id ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-muted")}>
                    {f.label} <span className="opacity-60">{items.filter(f.test).length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          ) : sorted.length ? (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sorted.map((item) => {
                const thumb = config.thumb?.(item);
                const url = config.collection ? publicUrl(config.collection, item) : null;
                return (
                  <li key={String(item.id ?? config.itemTitle(item))}>
                    <Card className="flex items-center gap-3 p-3 transition-shadow hover:shadow-lg">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setQuery({ edit: String(item.id) })}>
                        {config.thumb && (thumb ? <img src={imageUrl(thumb)} alt="" loading="lazy" className={thumbClass[config.thumbShape || "square"]} /> : <span className={cn("grid place-items-center bg-surface-2 text-muted", thumbClass[config.thumbShape || "square"])}><ImageIcon className="size-5" /></span>)}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{config.itemTitle(item) || "Senza titolo"}</span>
                          {config.itemSubtitle && <span className="block truncate text-sm text-muted">{config.itemSubtitle(item)}</span>}
                          {config.badges && <span className="mt-1 flex flex-wrap gap-1">{config.badges(item)}</span>}
                        </span>
                      </button>
                      {url && (
                        <a href={url} target="_blank" rel="noreferrer" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2" aria-label="Apri sul sito"><ExternalLink className="size-4" /></a>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={config.icon} title={search ? "Nessun risultato" : `Nessun ${config.singular}`} text={search ? "Prova con un'altra ricerca." : config.emptyText} action={<Button onClick={() => setQuery({ edit: "new" })}><Plus />Aggiungi {config.singular}</Button>} />
          )}
        </>
      )}
      <button type="button" onClick={() => setQuery({ edit: "new" })} aria-label={`Nuovo ${config.singular}`} className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-20 grid size-14 place-items-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/30 active:scale-95 sm:hidden">
        <Plus className="size-7" />
      </button>
      <ItemEditor<T>
        {...config.editor}
        doc={config.doc}
        list={config.list}
        item={editing}
        open={!!editId && (editId === "new" || !!editing)}
        onClose={() => setQuery({ edit: null }, { force: true })}
        hasDraft={hasDraft}
      />
    </>
  );
}

function ReorderList<T extends Item>({ config, items, original, onChange, onDone }: { config: CollectionConfig<T>; items: T[]; original: T[]; onChange: (v: T[]) => void; onDone: () => void }) {
  const save = useSave(config.doc);
  const [saving, setSaving] = React.useState<SaveMode | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const dirty = items.map((i) => String(i.id)).join("|") !== original.map((i) => String(i.id)).join("|");
  const move = (i: number, d: number) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  const submit = async (mode: SaveMode) => {
    setSaving(mode);
    setError(null);
    try {
      const ops: Op[] = items.map((item, index) => ({ type: "move", list: config.list, id: String(item.id), toIndex: index }));
      await save.mutateAsync({ ops, mode, summary: `Riordina ${config.title}` });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(null);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <ErrorBox error={error} />
      <p className="text-sm text-muted">L'ordine qui è quello mostrato sul sito.</p>
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={String(item.id)}>
            <Card className="flex items-center gap-2 p-2 pl-4">
              <span className="w-6 text-center font-display text-lg font-bold text-muted tabular">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{config.itemTitle(item)}</span>
              <Button variant="ghost" size="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Sposta su"><ArrowUp /></Button>
              <Button variant="ghost" size="icon" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Sposta giù"><ArrowDown /></Button>
            </Card>
          </li>
        ))}
      </ul>
      <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 rounded-2xl border border-border bg-surface p-3 shadow-xl lg:bottom-4">
        <SaveBar onSave={submit} saving={saving} dirty={dirty} />
        <Button variant="ghost" className="mt-2 w-full" onClick={onDone}>Annulla</Button>
      </div>
    </div>
  );
}
