import * as AlertPrimitive from "@radix-ui/react-alert-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, ChevronLeft, Plus, Search, X } from "lucide-react";
import * as React from "react";
import { cn, matchesSearch } from "@/lib/utils";
import { Button } from "./button";

const overlay = "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_150ms_ease-out]";

/**
 * Editor container: full screen on phones (like an iOS modal), side panel on
 * large screens. Header has a large close target; footer stays reachable.
 */
export function Sheet({ open, onOpenChange, title, subtitle, children, footer, headerActions, wide }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(overlay, "hidden lg:block")} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-background outline-none",
            "lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[min(640px,100vw)] lg:border-l lg:border-border lg:shadow-2xl",
            wide && "lg:w-[min(860px,100vw)]",
            "data-[state=open]:animate-[sheet-in_220ms_cubic-bezier(.2,.8,.2,1)]",
          )}
        >
          <header className="pt-safe sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur-xl">
            <div className="flex h-14 items-center gap-2 px-2 lg:px-4">
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Chiudi">
                  <ChevronLeft className="lg:hidden" />
                  <X className="hidden lg:block" />
                </Button>
              </DialogPrimitive.Close>
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="truncate font-display text-xl font-bold leading-tight">{title}</DialogPrimitive.Title>
                {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
              </div>
              {headerActions}
            </div>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 lg:px-6">{children}</div>
          {footer && <footer className="pb-safe border-t border-border bg-surface/95 px-4 pt-3 backdrop-blur-xl lg:px-6 [&>*]:mb-3">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface ConfirmAction { label: string; variant?: "default" | "destructive" | "outline" | "secondary"; onSelect: () => void | Promise<void> }

export function ConfirmDialog({ open, onOpenChange, title, description, actions, cancelLabel = "Annulla" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  actions: ConfirmAction[];
  cancelLabel?: string;
}) {
  const [busy, setBusy] = React.useState<number | null>(null);
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className={cn(overlay, "z-[60]")} />
        <AlertPrimitive.Content className="pb-safe fixed inset-x-0 bottom-0 z-[60] rounded-t-3xl border border-border bg-surface p-5 shadow-2xl outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
          <AlertPrimitive.Title className="font-display text-2xl font-bold">{title}</AlertPrimitive.Title>
          {description ? <AlertPrimitive.Description asChild><div className="mt-2 text-[15px] leading-relaxed text-muted">{description}</div></AlertPrimitive.Description> : <AlertPrimitive.Description className="sr-only">{title}</AlertPrimitive.Description>}
          <div className="mt-5 flex flex-col gap-2">
            {actions.map((a, i) => (
              <Button
                key={a.label}
                variant={a.variant || "default"}
                size="lg"
                loading={busy === i}
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(i);
                  try {
                    await a.onSelect();
                    onOpenChange(false);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {a.label}
              </Button>
            ))}
            <AlertPrimitive.Cancel asChild>
              <Button variant="ghost" size="lg" disabled={busy !== null}>{cancelLabel}</Button>
            </AlertPrimitive.Cancel>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}

export interface PickerOption { value: string; label: string; description?: string; group?: string; badge?: string }

/**
 * Searchable picker used for players, teams and opponents: type a few letters,
 * tap. Full screen on phones, centered on desktop. `allowCustom` lets the user
 * keep a value that is not in the list (exceptions), clearly labelled as such.
 */
export function SearchPicker({ open, onOpenChange, title, options, value, onChange, multiple, allowCustom, customLabel = "Usa", placeholder = "Cerca…", emptyText = "Nessun risultato" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  options: PickerOption[];
  value: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  allowCustom?: boolean;
  customLabel?: string;
  placeholder?: string;
  emptyText?: string;
}) {
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const filtered = options.filter((o) => matchesSearch(query, o.label, o.description, o.badge));
  const groups = [...new Set(filtered.map((o) => o.group || ""))];
  const exact = options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());
  const toggle = (v: string) => {
    if (!multiple) {
      onChange([v]);
      onOpenChange(false);
      return;
    }
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(overlay, "z-[55]")} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            // Focus on desktop only: on iPhone the keyboard would cover half the list immediately.
            if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
          }}
          className="fixed inset-0 z-[56] flex flex-col bg-background outline-none sm:inset-auto sm:left-1/2 sm:top-[10vh] sm:max-h-[80vh] sm:w-[520px] sm:-translate-x-1/2 sm:rounded-3xl sm:border sm:border-border sm:shadow-2xl"
        >
          <div className="pt-safe border-b border-border">
            <div className="flex h-14 items-center gap-2 px-2">
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Chiudi"><X /></Button>
              </DialogPrimitive.Close>
              <DialogPrimitive.Title className="flex-1 truncate font-display text-xl font-bold">{title}</DialogPrimitive.Title>
              {multiple && <Button size="sm" onClick={() => onOpenChange(false)}>Fatto{value.length ? ` (${value.length})` : ""}</Button>}
            </div>
            <div className="relative px-3 pb-3">
              <Search className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-[calc(50%+6px)] text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
            {allowCustom && query.trim() && !exact && (
              <button type="button" onClick={() => toggle(query.trim())} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-surface-2">
                <span className="grid size-8 place-items-center rounded-full bg-warning-soft text-warning"><Plus className="size-4" /></span>
                <span className="flex-1"><b>{customLabel} “{query.trim()}”</b><span className="block text-xs text-muted">Valore non presente nell'elenco</span></span>
              </button>
            )}
            {groups.map((g) => (
              <div key={g || "_"}>
                {g && <p className="px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-muted">{g}</p>}
                {filtered.filter((o) => (o.group || "") === g).map((o) => {
                  const selected = value.includes(o.value);
                  return (
                    <button
                      key={o.value + (o.group || "")}
                      type="button"
                      onClick={() => toggle(o.value)}
                      className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left transition-colors hover:bg-surface-2", selected && "bg-primary-soft")}
                    >
                      {o.badge && <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-surface-2 px-1 font-display text-base font-bold tabular">{o.badge}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{o.label}</span>
                        {o.description && <span className="block truncate text-xs text-muted">{o.description}</span>}
                      </span>
                      {selected && <Check className="size-5 text-primary" />}
                    </button>
                  );
                })}
              </div>
            ))}
            {!filtered.length && !(allowCustom && query.trim()) && <p className="px-3 py-10 text-center text-sm text-muted">{emptyText}</p>}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
