import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { toast, Toaster } from "sonner";
import { App } from "./App";
import { ApiError } from "./lib/api";
import "./styles.css";

function notifyAuth(error: unknown) {
  if (error instanceof ApiError && error.status === 401) toast.error("Sessione scaduta", { id: "auth", description: "Ricarica la pagina per accedere di nuovo.", duration: Infinity, action: { label: "Ricarica", onClick: () => window.location.reload() } });
  if (error instanceof ApiError && error.status === 429) toast.warning(error.message, { id: "rate" });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: notifyAuth }),
  mutationCache: new MutationCache({ onError: notifyAuth }),
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-center" richColors closeButton toastOptions={{ className: "font-sans" }} offset={{ top: "calc(env(safe-area-inset-top) + 12px)" }} mobileOffset={{ top: "calc(env(safe-area-inset-top) + 8px)" }} />
    </QueryClientProvider>
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/admin-v2/sw.js", { scope: "/admin-v2/" }).catch(() => undefined);
  });
}
