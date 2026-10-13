import { AlertTriangle, CloudUpload, FileClock, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import * as React from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import type { DocumentId } from "@shared/documents";
import { canonicalJson, clone } from "@shared/json";
import type { Op } from "@shared/ops";
import type { RuleContext } from "@shared/rules";
import { ApiError } from "@/lib/api";
import { deleteOp, errorMessages, upsertOp, useSave, type SaveMode } from "@/lib/docs";
import { addNavigationGuard } from "@/lib/router";
import { Button } from "./ui/button";
import { ConfirmDialog, Sheet } from "./ui/dialogs";

export function ErrorBox({ error, onReload }: { error: unknown; onReload?: () => void }) {
  if (!error) return null;
  const { title, items } = errorMessages(error);
  const conflict = error instanceof ApiError && error.status === 409;
  return (
    <div role="alert" className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
      <p className="flex items-start gap-2 font-semibold"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{title}</p>
      {items.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-6">{items.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {conflict && onReload && <Button size="sm" variant="outline" className="mt-3" onClick={onReload}><RefreshCw />Ricarica la versione aggiornata</Button>}
    </div>
  );
}

export function SaveBar({ onSave, saving, dirty, isNew, hasDraft, disabled }: { onSave: (mode: SaveMode) => void; saving: SaveMode | null; dirty: boolean; isNew?: boolean; hasDraft?: boolean; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {hasDraft && <p className="flex items-center gap-1.5 text-xs text-warning"><FileClock className="size-3.5" />Questo contenuto ha modifiche in bozza: “Pubblica” pubblicherà anche quelle.</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={() => onSave("draft")} loading={saving === "draft"} disabled={(!dirty && !isNew) || saving !== null || disabled}>
          <FileClock />Salva bozza
        </Button>
        <Button size="lg" onClick={() => onSave("publish")} loading={saving === "publish"} disabled={(!dirty && !isNew && !hasDraft) || saving !== null || disabled}>
          <CloudUpload />Pubblica
        </Button>
      </div>
    </div>
  );
}

export function useUnsavedGuard(dirty: boolean) {
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    const remove = addNavigationGuard(() => window.confirm("Ci sono modifiche non salvate. Vuoi uscire e perderle?"));
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      remove();
    };
  }, [dirty]);
}

export interface ItemEditorProps<T extends Record<string, unknown>> {
  doc: DocumentId;
  list: string[];
  /** The item as stored (null for a new one). */
  item: T | null;
  open: boolean;
  onClose: () => void;
  title: (value: T) => React.ReactNode;
  subtitle?: React.ReactNode;
  create: () => T;
  children: (value: T, set: <K extends keyof T>(key: K, v: T[K]) => void, replace: (v: T) => void) => React.ReactNode;
  position?: "start" | "end";
  context?: RuleContext;
  hasDraft?: boolean;
  wide?: boolean;
  /** Turns the edited value into what is stored (e.g. drop UI-only fields). */
  serialize?: (value: T) => T;
  deleteLabel?: string;
  extraOps?: (value: T) => Promise<Op[]>;
  summary?: (value: T, isNew: boolean) => string;
}

const EMPTY: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>;

/** Generic add/edit sheet for an item of a list, with draft and publish. */
export function ItemEditor<T extends Record<string, unknown>>(props: ItemEditorProps<T>) {
  const { doc, list, open, onClose } = props;
  const qc = useQueryClient();
  // The item is frozen when the editor opens: background refetches must not
  // reset the form, and this snapshot is the base for conflict detection.
  const key = open ? (props.item ? `id:${String(props.item.id)}` : "new") : "closed";
  const [snapshot, setSnapshot] = React.useState<{ key: string; item: T | null; initial: T } | null>(null);
  if (!open && snapshot) setSnapshot(null);
  if (open && snapshot?.key !== key) {
    const item = props.item ? clone(props.item) : null;
    setSnapshot({ key, item, initial: item ? clone(item) : props.create() });
  }
  const item = snapshot?.item ?? null;
  const initial = snapshot?.initial ?? (EMPTY as T);
  const isNew = !item;
  const [value, setValue] = React.useState<T>(initial);
  const [saving, setSaving] = React.useState<SaveMode | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  React.useEffect(() => {
    setValue(initial);
    setError(null);
  }, [initial]);
  const dirty = canonicalJson(value) !== canonicalJson(initial);
  useUnsavedGuard(open && dirty);
  const save = useSave(doc);

  const set = React.useCallback(<K extends keyof T>(key: K, v: T[K]) => setValue((prev) => ({ ...prev, [key]: v })), []);

  const submit = async (mode: SaveMode) => {
    setSaving(mode);
    setError(null);
    try {
      const stored = props.serialize ? props.serialize(value) : value;
      const ops = [await upsertOp(list, item, stored, props.position), ...(props.extraOps ? await props.extraOps(stored) : [])];
      await save.mutateAsync({ ops, mode, context: props.context, summary: props.summary?.(stored, isNew) });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(null);
    }
  };

  const remove = async (mode: SaveMode) => {
    if (!item) return;
    try {
      await save.mutateAsync({ ops: [await deleteOp(list, item)], mode, summary: `Elimina ${String(item.title || item.name || item.id)}` });
      onClose();
    } catch (e) {
      setError(e);
      throw e;
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Ci sono modifiche non salvate. Vuoi chiudere e perderle?")) return;
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && close()}
      title={props.title(value)}
      subtitle={props.subtitle ?? (isNew ? "Nuovo elemento" : dirty ? "Modifiche non salvate" : undefined)}
      wide={props.wide}
      headerActions={
        !isNew && (
          <Dropdown.Root>
            <Dropdown.Trigger asChild><Button variant="ghost" size="icon" aria-label="Altre azioni"><MoreHorizontal /></Button></Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content align="end" sideOffset={6} className="z-[60] min-w-[200px] rounded-2xl border border-border bg-surface p-1 shadow-xl">
                <Dropdown.Item onSelect={() => setConfirmDelete(true)} className="flex h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-danger outline-none data-[highlighted]:bg-danger-soft">
                  <Trash2 className="size-4" />{props.deleteLabel || "Elimina"}
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        )
      }
      footer={<SaveBar onSave={submit} saving={saving} dirty={dirty} isNew={isNew} hasDraft={props.hasDraft} />}
    >
      <ErrorBox error={error} onReload={() => { qc.invalidateQueries({ queryKey: ["doc", doc] }); onClose(); }} />
      <div className="flex flex-col gap-5 pb-6">{props.children(value, set, setValue)}</div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Eliminare questo elemento?"
        description="Potrai recuperarlo dalla cronologia delle versioni. Se è pubblicato, la sua pagina sparirà dal sito dopo la pubblicazione."
        actions={[
          { label: "Elimina e pubblica", variant: "destructive", onSelect: () => remove("publish") },
          { label: "Elimina solo in bozza", variant: "outline", onSelect: () => remove("draft") },
        ]}
      />
    </Sheet>
  );
}

/** Section title inside forms. */
export function FormSection({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-bold leading-tight">{title}</h3>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
