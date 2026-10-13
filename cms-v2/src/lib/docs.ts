import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DOCUMENTS, type DocumentId } from "@shared/documents";
import { valueHash } from "@shared/json";
import type { Op } from "@shared/ops";
import { processEdit } from "@shared/pipeline";
import type { RuleIssue } from "@shared/rules";
import { api, ApiError, type DocumentPayload, type SaveResult } from "./api";

export type SaveMode = "draft" | "publish";

export function useDocument<T = Record<string, unknown>>(doc: DocumentId) {
  const query = useQuery({
    queryKey: ["doc", doc],
    queryFn: () => api.document<T>(doc),
  });
  const data = query.data as DocumentPayload<T> | undefined;
  /** What the editor works on: the draft when there is one, otherwise the published version. */
  const content = data ? (data.draft?.content ?? data.published.content) : undefined;
  return { ...query, payload: data, content, hasDraft: !!data?.draft };
}

export function useDocumentsSummary() {
  return useQuery({ queryKey: ["documents"], queryFn: () => api.documents(), refetchInterval: 60_000 });
}

export class LocalValidationError extends Error {
  constructor(public errors: RuleIssue[], public warnings: RuleIssue[]) {
    super("validation");
  }
}

export interface SaveOptions { mode: SaveMode; summary?: string; context?: Parameters<typeof processEdit>[3]; silent?: boolean }

/**
 * Saves operations on a document. They are first validated locally with the
 * same shared code the server runs, so errors show instantly; the server
 * validates again and is the only authority.
 */
export function useSave(doc: DocumentId) {
  const qc = useQueryClient();
  return useMutation<SaveResult, Error, { ops: Op[] } & SaveOptions>({
    mutationFn: async ({ ops, mode, summary, context }) => {
      const cached = qc.getQueryData<DocumentPayload>(["doc", doc]);
      const base = cached ? (cached.draft?.content ?? cached.published.content) : null;
      if (base) {
        const local = await processEdit(doc, base, ops, context);
        if (local.errors.length) throw new LocalValidationError(local.errors, local.warnings);
      }
      return api.edit(doc, ops, mode, summary);
    },
    onSuccess: (result, vars) => {
      qc.invalidateQueries({ queryKey: ["doc", doc] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["status"] });
      if (vars.silent) return;
      if (result.status === "unchanged") toast.info("Nessuna modifica da salvare");
      else if (result.status === "draft") toast.success("Bozza salvata", { description: "Non è ancora visibile sul sito." });
      else toast.success("Pubblicato", { description: "Il sito si aggiorna in circa un minuto." });
      for (const w of result.warnings || []) toast.warning(w.message);
    },
  });
}

export function useDraftActions(doc: DocumentId) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["doc", doc] });
    qc.invalidateQueries({ queryKey: ["documents"] });
    qc.invalidateQueries({ queryKey: ["status"] });
  };
  const publish = useMutation({
    mutationFn: (keep: boolean = false) => api.publish(doc, keep),
    onSuccess: (r) => {
      refresh();
      toast.success(r.status === "unchanged" ? "La bozza era già uguale alla versione pubblicata" : `${DOCUMENTS[doc].label}: bozza pubblicata`);
    },
  });
  const discard = useMutation({
    mutationFn: () => api.discard(doc),
    onSuccess: () => {
      refresh();
      toast.success("Bozza scartata");
    },
  });
  return { publish, discard };
}

export async function upsertOp(list: string[], original: Record<string, unknown> | null, value: Record<string, unknown>, position?: "start" | "end"): Promise<Op> {
  if (!original || original.id == null) return { type: "upsert", list, id: null, base: null, value, ...(position ? { position } : {}) };
  return { type: "upsert", list, id: String(original.id), base: await valueHash(original), value };
}

export async function deleteOp(list: string[], original: Record<string, unknown>): Promise<Op> {
  return { type: "delete", list, id: String(original.id), base: await valueHash(original) };
}

export async function setOp(path: string[], original: unknown, value: unknown): Promise<Op> {
  return { type: "set", path, base: await valueHash(original ?? null), value };
}

export function errorMessages(error: unknown): { title: string; items: string[] } {
  if (error instanceof LocalValidationError) return { title: "Correggi questi campi", items: error.errors.map((e) => e.message) };
  if (error instanceof ApiError) {
    const items = [...(error.details?.errors?.map((e) => e.message) || []), ...(error.details?.conflicts || [])];
    return { title: error.message, items };
  }
  return { title: error instanceof Error ? error.message : "Errore sconosciuto", items: [] };
}
