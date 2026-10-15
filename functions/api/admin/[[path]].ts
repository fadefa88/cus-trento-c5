// Cloudflare Pages Function for the Admin V2 API. All logic lives in
// cms-v2/server; this file only maps the Pages environment to it.
// Configuration: docs/ADMIN_V2.md and cms-v2/README.md.
import { handleApi } from "../../../cms-v2/server/api";
import { GitHubStore } from "../../../cms-v2/server/github";
import type { KV } from "../../../cms-v2/server/guards";
import { normalizeAdminHost } from "../../../cms-v2/server/host";

interface Env {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CMS_ADMIN_EMAILS?: string;
  CMS_REPO?: string;
  CMS_MAIN_BRANCH?: string;
  CMS_DRAFT_BRANCH?: string;
  // GitHub App credentials (Cloudflare Pages secrets). G_APP_* is the
  // documented name; GITHUB_APP_* is still accepted.
  G_APP_ID?: string;
  G_APP_PRIVATE_KEY?: string;
  G_APP_INSTALLATION_ID?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  CMS_GITHUB_TOKEN?: string;
  CMS_DRAFT_PREVIEW_URL?: string;
  CMS_ADMIN_HOST?: string;
  CMS_KV?: KV;
  // Cloudflare Web Analytics, read-only (dashboard visitor statistics).
  CF_ANALYTICS_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_WEB_ANALYTICS_SITE_TAG?: string;
  CF_ANALYTICS_HOSTS?: string;
}

export const onRequest = (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const repo = env.CMS_REPO || "fadefa88/cus-trento-c5";
  return handleApi(request, {
    access: { teamDomain: env.CF_ACCESS_TEAM_DOMAIN, audience: env.CF_ACCESS_AUD, admins: env.CMS_ADMIN_EMAILS },
    store: () =>
      new GitHubStore({
        repo,
        appId: env.G_APP_ID || env.GITHUB_APP_ID,
        appPrivateKey: env.G_APP_PRIVATE_KEY || env.GITHUB_APP_PRIVATE_KEY,
        installationId: env.G_APP_INSTALLATION_ID || env.GITHUB_APP_INSTALLATION_ID,
        token: env.CMS_GITHUB_TOKEN,
      }),
    kv: env.CMS_KV,
    analytics: { apiToken: env.CF_ANALYTICS_API_TOKEN, accountId: env.CF_ACCOUNT_ID, siteTag: env.CF_WEB_ANALYTICS_SITE_TAG, hosts: env.CF_ANALYTICS_HOSTS },
    repo,
    previewUrl: env.CMS_DRAFT_PREVIEW_URL,
    adminHost: normalizeAdminHost(env.CMS_ADMIN_HOST),
    branches: { main: env.CMS_MAIN_BRANCH || "main", drafts: env.CMS_DRAFT_BRANCH || "cms-v2-drafts" },
  });
};
