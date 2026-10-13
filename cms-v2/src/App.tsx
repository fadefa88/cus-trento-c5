import { Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import * as React from "react";
import { AppShell, useSession } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useRoute } from "@/lib/router";

// Each section is loaded on demand: the first screen on a phone stays light.
const lazyNamed = <K extends string>(load: () => Promise<Record<K, React.ComponentType<any>>>, name: K) => React.lazy(() => load().then((m) => ({ default: m[name] }))); // eslint-disable-line @typescript-eslint/no-explicit-any
const Dashboard = lazyNamed(() => import("@/modules/dashboard"), "Dashboard");
const MatchesPage = lazyNamed(() => import("@/modules/matches"), "MatchesPage");
const RosterPage = lazyNamed(() => import("@/modules/roster"), "RosterPage");
const LeaguePage = lazyNamed(() => import("@/modules/league"), "LeaguePage");
const NewsPage = lazyNamed(() => import("@/modules/news"), "NewsPage");
const ClubHistoryPage = lazyNamed(() => import("@/modules/history"), "ClubHistoryPage");
const collections = () => import("@/modules/collections");
const GalleryPage = lazyNamed(collections, "GalleryPage");
const VideosPage = lazyNamed(collections, "VideosPage");
const EventsPage = lazyNamed(collections, "EventsPage");
const StaffPage = lazyNamed(collections, "StaffPage");
const SponsorsPage = lazyNamed(collections, "SponsorsPage");
const PackagesPage = lazyNamed(collections, "PackagesPage");
const system = () => import("@/modules/system");
const PublishPage = lazyNamed(system, "PublishPage");
const VersionsPage = lazyNamed(system, "VersionsPage");
const MediaPage = lazyNamed(system, "MediaPage");
const SettingsPage = lazyNamed(system, "SettingsPage");

function Page() {
  const { segments } = useRoute();
  const [first, second] = segments;
  switch (first) {
    case undefined: return <Dashboard />;
    case "partite": return <MatchesPage key={second} team={second === "u23" ? "u23" : "prima"} />;
    case "rosa": return <RosterPage />;
    case "league": return <LeaguePage />;
    case "news": return <NewsPage />;
    case "gallery": return <GalleryPage />;
    case "video": return <VideosPage />;
    case "eventi": return <EventsPage />;
    case "storia": return <ClubHistoryPage />;
    case "staff": return <StaffPage />;
    case "sponsor": return <SponsorsPage />;
    case "pacchetti": return <PackagesPage />;
    case "pubblica": return <PublishPage />;
    case "cronologia": return <VersionsPage />;
    case "media": return <MediaPage />;
    case "impostazioni": return <SettingsPage />;
    default: return <div className="py-20 text-center"><p className="font-display text-3xl font-bold">Pagina non trovata</p><a href="#/" className="mt-3 inline-block text-primary">Torna alla dashboard</a></div>;
  }
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <p className="font-display text-3xl font-bold">Qualcosa è andato storto</p>
        <p className="mt-2 text-muted">Le modifiche salvate sono al sicuro. Ricarica la pagina per continuare.</p>
        <Button className="mt-6" onClick={() => window.location.reload()}><RefreshCw />Ricarica</Button>
      </div>
    );
  }
}

function Gate({ children }: { children: React.ReactNode }) {
  const session = useSession();
  if (session.isLoading) return <div className="grid min-h-dvh place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div>;
  if (session.error) {
    const e = session.error;
    const auth = e instanceof ApiError && (e.status === 401 || e.status === 403);
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary"><LockKeyhole /></div>
          <p className="mt-4 font-display text-3xl font-bold">{auth ? (e.status === 403 ? "Accesso non autorizzato" : "Accesso richiesto") : "Servizio non disponibile"}</p>
          <p className="mt-2 text-muted">{e.message}</p>
          <Button className="mt-6" onClick={() => window.location.reload()}><RefreshCw />Riprova</Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <ErrorBoundary>
      <Gate>
        <AppShell>
          <ErrorBoundary>
            <React.Suspense fallback={<div className="grid place-items-center py-24"><Loader2 className="size-7 animate-spin text-primary" /></div>}>
              <Page />
            </React.Suspense>
          </ErrorBoundary>
        </AppShell>
      </Gate>
    </ErrorBoundary>
  );
}
