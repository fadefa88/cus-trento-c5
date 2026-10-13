import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PAGES = ["", "#/partite/prima", "#/partite/u23", "#/rosa", "#/league", "#/league?tab=tabellone", "#/league?tab=squadre", "#/league?tab=regolamento", "#/news", "#/gallery", "#/video", "#/eventi", "#/storia", "#/staff", "#/sponsor", "#/pacchetti", "#/pubblica", "#/cronologia/fixtures", "#/media", "#/impostazioni"];

async function open(page: Page, hash: string) {
  await page.goto(hash ? `./${hash}` : "./");
  await expect(page.locator("main")).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("layout", () => {
  for (const hash of PAGES) {
    test(`no horizontal scrolling: ${hash || "dashboard"}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await open(page, hash);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }

  test("editors fit the screen too", async ({ page }) => {
    for (const hash of ["#/partite/prima", "#/rosa", "#/news", "#/league?tab=squadre"]) {
      await open(page, hash);
      await page.goto(`./${hash}${hash.includes("?") ? "&" : "?"}edit=new`);
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("touch and accessibility", () => {
  test("primary controls are at least 44px tall on phones", async ({ page }, info) => {
    test.skip(!info.project.name.startsWith("iphone"), "phone only");
    await open(page, "");
    const nav = page.getByRole("navigation", { name: "Navigazione principale" });
    for (const link of await nav.locator("a, button").all()) {
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.goto("./#/partite/prima?edit=new");
    for (const b of await page.getByRole("dialog").getByRole("button", { name: /Salva bozza|Pubblica/ }).all()) {
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("inputs use at least 16px text so iOS does not zoom", async ({ page }, info) => {
    test.skip(!info.project.name.startsWith("iphone"), "phone only");
    await page.goto("./#/rosa?edit=new");
    await expect(page.getByRole("dialog").getByLabel("Nome")).toBeVisible();
    const sizes = await page.getByRole("dialog").locator("input:not([type=file]):not([type=range]):not([type=checkbox]), select, textarea").evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
  });

  for (const hash of ["", "#/partite/prima", "#/league", "#/news", "#/rosa?edit=new"]) {
    test(`no serious accessibility violations: ${hash || "dashboard"}`, async ({ page }, info) => {
      test.skip(info.project.name !== "iphone" && info.project.name !== "desktop", "two viewports are enough");
      await open(page, hash);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).disableRules(["color-contrast"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    });
  }

  test("dark mode applies", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page, "");
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(12, 12, 14)");
  });
});
