// The CMS is served only from the host protected by Cloudflare Access
// (CMS_ADMIN_HOST, e.g. cus-trento-c5.pages.dev) and its preview subdomains.
// The public domain is a CNAME managed outside Cloudflare, so Access cannot
// cover it: there the API answers 404 and /admin-v2/ redirects to the admin host.

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normalizeAdminHost(value: string | undefined): string | null {
  const host = String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return host && HOSTNAME.test(host) ? host : null;
}

/** True when no admin host is configured, or the request host is it or one of its subdomains (previews). */
export function isAdminHost(requestUrl: string, adminHost: string | null): boolean {
  if (!adminHost) return true;
  const host = new URL(requestUrl).hostname.toLowerCase();
  return host === adminHost || host.endsWith(`.${adminHost}`);
}

/** Redirect for /admin-v2/ requests arriving on another host, or null to serve them. */
export function adminRedirect(request: Request, adminHost: string | null): Response | null {
  if (isAdminHost(request.url, adminHost)) return null;
  const url = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: { Location: `https://${adminHost}${url.pathname}${url.search}`, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
