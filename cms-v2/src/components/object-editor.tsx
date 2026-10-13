import * as React from "react";
import type { DocumentId } from "@shared/documents";
import { canonicalJson, clone, getAt } from "@shared/json";
import type { Op } from "@shared/ops";
import { setOp, useDraftActions, useSave, type SaveMode } from "@/lib/docs";
import { ErrorBox, SaveBar, useUnsavedGuard } from "./editor";

/**
 * Edits fields of an object inside a document (e.g. League info, club history).
 * Each changed key becomes its own guarded `set` operation, so two people
 * editing different fields of the same object do not conflict.
 */
export function ObjectEditor<T extends Record<string, unknown>>({ doc, path, source, keys, children, hasDraft, summary, footerClassName }: {
  doc: DocumentId;
  path: string[];
  source: Record<string, unknown> | undefined;
  keys: Array<keyof T & string>;
  children: (value: T, set: <K extends keyof T>(key: K, v: T[K]) => void) => React.ReactNode;
  hasDraft?: boolean;
  summary: string;
  footerClassName?: string;
}) {
  const original = React.useMemo(() => {
    const obj = (source ? getAt(source, path) : undefined) as T | undefined;
    return clone(obj || ({} as T));
  }, [source, path.join("/")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [value, setValue] = React.useState<T>(original);
  const [base, setBase] = React.useState<T>(original);
  const [saving, setSaving] = React.useState<SaveMode | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const dirtyKeys = keys.filter((k) => canonicalJson(value[k]) !== canonicalJson(base[k]));
  const dirty = dirtyKeys.length > 0;
  // Adopt fresh server data only when the user has nothing pending.
  React.useEffect(() => {
    if (!dirty) {
      setValue(original);
      setBase(original);
    }
  }, [original]); // eslint-disable-line react-hooks/exhaustive-deps
  useUnsavedGuard(dirty);
  const save = useSave(doc);
  const { publish } = useDraftActions(doc);
  const set = <K extends keyof T>(key: K, v: T[K]) => setValue((prev) => ({ ...prev, [key]: v }));
  const submit = async (mode: SaveMode) => {
    setSaving(mode);
    setError(null);
    try {
      const ops: Op[] = await Promise.all(dirtyKeys.map((k) => setOp([...path, k], base[k], value[k])));
      if (!ops.length) {
        // Nothing changed here: "Pubblica" publishes the pending draft of the document.
        if (mode === "publish") await publish.mutateAsync(false);
      } else await save.mutateAsync({ ops, mode, summary });
      setBase(value);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(null);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <ErrorBox error={error} onReload={() => { setValue(original); setBase(original); setError(null); }} />
      {children(value, set)}
      <div className={footerClassName ?? "sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 rounded-2xl border border-border bg-surface/95 p-3 shadow-xl backdrop-blur lg:bottom-4"}>
        <SaveBar onSave={submit} saving={saving} dirty={dirty} hasDraft={hasDraft} />
      </div>
    </div>
  );
}
