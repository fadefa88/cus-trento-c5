// Hash router: leaves the site's generated _redirects and SPA fallback
// untouched and behaves the same in the installed iOS app. Editors live in the
// URL (?edit=id), so the back gesture closes them.
import { useSyncExternalStore } from "react";

export interface Route { path: string; segments: string[]; query: URLSearchParams }

function read(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  const clean = "/" + path.split("/").filter(Boolean).join("/");
  return { path: clean, segments: clean.split("/").filter(Boolean), query: new URLSearchParams(qs) };
}

let current = read();
const listeners = new Set<() => void>();
function emit() {
  current = read();
  listeners.forEach((l) => l());
}
window.addEventListener("hashchange", emit);
window.addEventListener("popstate", emit);

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

type Guard = () => boolean;
const guards = new Set<Guard>();
/** Registers a check that runs before navigating away (unsaved changes). */
export function addNavigationGuard(guard: Guard) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export function href(path: string, query?: Record<string, string | null | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v != null && v !== "") qs.set(k, v);
  const s = qs.toString();
  return `#${path}${s ? `?${s}` : ""}`;
}

export function navigate(path: string, query?: Record<string, string | null | undefined>, opts: { replace?: boolean; force?: boolean } = {}) {
  if (!opts.force) for (const g of guards) if (!g()) return false;
  const target = href(path, query);
  if (opts.replace) window.history.replaceState(null, "", target);
  else window.history.pushState(null, "", target);
  emit();
  return true;
}

export function setQuery(patch: Record<string, string | null | undefined>, opts: { replace?: boolean; force?: boolean } = {}) {
  const q = Object.fromEntries(current.query.entries()) as Record<string, string | null | undefined>;
  return navigate(current.path, { ...q, ...patch }, opts);
}
