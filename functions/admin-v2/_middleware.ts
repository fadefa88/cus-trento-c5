// /admin-v2/ is usable only on the host protected by Cloudflare Access
// (CMS_ADMIN_HOST). Requests on the public domain are redirected there; on the
// admin host the static app is served as usual. See cms-v2/README.md.
import { adminRedirect, normalizeAdminHost } from "../../cms-v2/server/host";

interface Env { CMS_ADMIN_HOST?: string }

export const onRequest = (context: { request: Request; env: Env; next: () => Promise<Response> }) =>
  adminRedirect(context.request, normalizeAdminHost(context.env.CMS_ADMIN_HOST)) ?? context.next();
