import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-xl border border-border bg-surface px-3.5 text-foreground placeholder:text-muted/70 shadow-[inset_0_1px_0_rgb(0_0_0/0.02)] transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-11", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "min-h-[96px] py-2.5 leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";

/** Native select: on iPhone it opens the system wheel, the most comfortable picker for short lists. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select ref={ref} className={cn(fieldBase, "h-11 appearance-none pr-10", className)} {...props}>
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
  </div>
));
NativeSelect.displayName = "NativeSelect";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-semibold text-foreground/80", className)} {...props} />;
}

export function Field({ label, hint, error, children, className, htmlFor, required }: { label?: React.ReactNode; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string; htmlFor?: string; required?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-primary">*</span>}
        </Label>
      )}
      {children}
      {error ? <p className="text-[13px] text-danger">{error}</p> : hint ? <p className="text-[13px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}

export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "primary" | "success" | "warning" | "danger" }) {
  const tones = {
    neutral: "bg-surface-2 text-muted border-border",
    primary: "bg-primary-soft text-primary border-transparent",
    success: "bg-success-soft text-success border-transparent",
    warning: "bg-warning-soft text-warning border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
  };
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold", tones[tone], className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-surface shadow-card", className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-border/60", className)} />;
}

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn("relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border transition-colors data-[state=checked]:bg-success focus-visible:outline-2", className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-6 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[21px]" />
    </SwitchPrimitive.Root>
  );
}

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "h-10 shrink-0 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-muted transition-colors data-[state=active]:border-foreground data-[state=active]:bg-foreground data-[state=active]:text-background",
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

export function SegmentedControl<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: React.ReactNode }>; className?: string }) {
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-xl border border-border bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-9 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold text-muted transition-colors", value === o.value && "bg-surface text-foreground shadow-sm")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: React.ComponentType<{ className?: string }>; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Icon className="size-6" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        {text && <p className="mt-1 text-sm text-muted">{text}</p>}
      </div>
      {action}
    </div>
  );
}
