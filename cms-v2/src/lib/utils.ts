import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFmt = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "2-digit", month: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function parseIsoDate(value: unknown): Date | null {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function formatDate(value: unknown, withWeekday = false) {
  const d = parseIsoDate(value);
  if (!d) return "—";
  return (withWeekday ? weekdayFmt : dateFmt).format(d);
}

export function formatDateTime(value: unknown) {
  const d = new Date(String(value || ""));
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

export function relativeTime(value: unknown) {
  const d = new Date(String(value || ""));
  if (Number.isNaN(d.getTime())) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "adesso";
  if (diff < 3600) return `${Math.floor(diff / 60)} min fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h fa`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} g fa`;
  return formatDateTime(value);
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function normalizeSearch(value: unknown) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function matchesSearch(query: string, ...fields: unknown[]) {
  const q = normalizeSearch(query).trim();
  if (!q) return true;
  const hay = normalizeSearch(fields.join(" "));
  return q.split(/\s+/).every((part) => hay.includes(part));
}

/** Uploaded files reach the public site only after the next deployment: until then they are read through the API. */
const pendingUploads = new Set<string>();
export function markPendingUpload(path: string) {
  pendingUploads.add(path);
}
export function imageUrl(path: unknown): string {
  const p = String(path || "").trim();
  if (!p) return "";
  if (pendingUploads.has(p) && p.startsWith("/img/uploads/")) return `/api/admin/media/raw?path=${encodeURIComponent(p.slice(1))}`;
  return p;
}
