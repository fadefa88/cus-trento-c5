import { describe, expect, it } from "vitest";
import { adminRedirect, isAdminHost, normalizeAdminHost } from "../server/host";
import { onRequest } from "../../functions/admin-v2/_middleware";

const ADMIN = "cus-trento-c5.pages.dev";

describe("admin host", () => {
  it("normalizes the configured value and rejects garbage", () => {
    expect(normalizeAdminHost(" https://Cus-Trento-C5.pages.dev/admin-v2/ ")).toBe(ADMIN);
    expect(normalizeAdminHost("")).toBeNull();
    expect(normalizeAdminHost("evil.com/<script>")).toBe("evil.com");
    expect(normalizeAdminHost("not a host")).toBeNull();
  });

  it("accepts the admin host and its preview subdomains only", () => {
    expect(isAdminHost(`https://${ADMIN}/api/admin/session`, ADMIN)).toBe(true);
    expect(isAdminHost(`https://cms-v2-drafts.${ADMIN}/admin-v2/`, ADMIN)).toBe(true);
    expect(isAdminHost("https://calcioa5.custrento.it/api/admin/session", ADMIN)).toBe(false);
    expect(isAdminHost(`https://${ADMIN}.evil.com/`, ADMIN)).toBe(false);
    expect(isAdminHost(`https://evil-${ADMIN}/`, ADMIN)).toBe(false);
    expect(isAdminHost("https://calcioa5.custrento.it/", null)).toBe(true);
  });

  it("redirects /admin-v2/ on the public domain, keeping path and query", async () => {
    const res = adminRedirect(new Request("https://calcioa5.custrento.it/admin-v2/?x=1#/league"), ADMIN)!;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`https://${ADMIN}/admin-v2/?x=1`);
  });

  it("middleware serves the app on the admin host and redirects elsewhere", async () => {
    const next = async () => new Response("app");
    const env = { CMS_ADMIN_HOST: ADMIN };
    expect(await (await onRequest({ request: new Request(`https://${ADMIN}/admin-v2/`), env, next })).text()).toBe("app");
    expect((await onRequest({ request: new Request("https://calcioa5.custrento.it/admin-v2/"), env, next })).status).toBe(302);
    expect(await (await onRequest({ request: new Request("https://calcioa5.custrento.it/admin-v2/"), env: {}, next })).text()).toBe("app");
  });
});
