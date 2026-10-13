import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the Vite dev server, which runs the real API on an
// in-memory copy of the repository (nothing is written to disk or GitHub).
// WebKit is the engine of Safari on iOS: run it where the host supports it
// (macOS, Linux CI with `npx playwright install --with-deps webkit`).
const withWebkit = process.env.CMS_E2E_WEBKIT === "1";

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5175/admin-v2/", trace: "retain-on-failure" },
  webServer: {
    command: "npx vite --config vite.config.mts --port 5175 --strictPort --logLevel error",
    stdout: "ignore",
    stderr: "ignore",
    url: "http://localhost:5175/admin-v2/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 15 Pro"], browserName: "chromium" } },
    { name: "iphone-se", use: { ...devices["iPhone SE"], browserName: "chromium" } },
    { name: "ipad", use: { ...devices["iPad (gen 7)"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    ...(withWebkit ? [{ name: "iphone-webkit", use: { ...devices["iPhone 15 Pro"] } }] : []),
  ],
});
