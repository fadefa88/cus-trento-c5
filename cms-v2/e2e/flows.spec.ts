import { expect, test } from "@playwright/test";

// Real editing flows through the UI and the real API (in-memory repository).
test.beforeEach(async ({}, info) => {
  test.skip(info.project.name !== "iphone" && info.project.name !== "desktop", "flows run on phone and desktop");
});

const dialog = (page: import("@playwright/test").Page) => page.getByRole("dialog").last();

test("enter a result as draft, then publish the draft", async ({ page }) => {
  await page.goto("./#/partite/u23");
  await page.getByRole("heading", { name: /Prossime partite/ }).waitFor();
  await page.locator("section", { has: page.getByRole("heading", { name: /Prossime partite/ }) }).locator("li button").first().click();
  const d = dialog(page);
  await d.getByRole("radio", { name: "Terminata" }).click();
  await d.getByRole("button", { name: "Gol casa: più" }).click();
  await d.getByRole("button", { name: "Gol casa: più" }).click();
  await d.getByRole("button", { name: "Gol trasferta: più" }).click();
  // A terminated match needs the goalkeepers who conceded the goals.
  await d.getByRole("button", { name: "Salva bozza" }).click();
  await expect(d.getByRole("alert")).toContainText("Seleziona il portiere");
  await d.getByRole("tab", { name: "Eventi" }).click();
  await d.getByRole("button", { name: "Portiere" }).click();
  await d.getByRole("button", { name: "Salva bozza" }).click();
  await expect(page.getByText("Bozza salvata")).toBeVisible();
  await expect(page.getByText(/Bozza non pubblicata/)).toBeVisible();
  await page.getByRole("button", { name: "Pubblica bozza" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Pubblica", exact: true }).click();
  await expect(page.getByText(/bozza pubblicata/i)).toBeVisible();
  await expect(page.getByText(/Bozza non pubblicata/)).toHaveCount(0);
});

test("add a player and publish", async ({ page }) => {
  const name = `Prova Giocatore ${Date.now().toString().slice(-5)}`;
  await page.goto("./#/rosa?edit=new");
  const d = dialog(page);
  await d.getByLabel("Nome").fill(name);
  await d.getByLabel("Numero").fill("77");
  await d.getByLabel("Ruolo").selectOption("Pivot");
  await d.getByRole("button", { name: "Pubblica" }).click();
  await expect(page.getByText("Pubblicato", { exact: true })).toBeVisible();
  await page.getByPlaceholder(/Cerca/).fill(name);
  await expect(page.getByText(name)).toBeVisible();
});

test("League scorer picker offers only the two teams and own goal", async ({ page }) => {
  await page.goto("./#/league");
  await page.locator("main li button").first().click();
  const d = dialog(page);
  const title = await d.getByRole("heading").first().textContent();
  const [home] = (title || "").split(" – ");
  await d.getByRole("button", { name: "Gol", exact: true }).first().click();
  const picker = dialog(page);
  await expect(picker.getByText("Autogol", { exact: true })).toBeVisible();
  const groups = await picker.locator("p.uppercase").allTextContents();
  expect(groups.every((g) => g === "Speciale" || g === `Rosa ${home.trim()}`)).toBe(true);
});

test("write a news article with rich text and publish it", async ({ page }) => {
  const title = `Articolo di prova ${Date.now().toString().slice(-5)}`;
  await page.goto("./#/news?edit=new");
  const d = dialog(page);
  await d.getByRole("textbox", { name: /Titolo/ }).fill(title);
  const editor = d.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Grande vittoria del CUS.");
  await d.getByRole("button", { name: "Pubblica" }).click();
  await expect(page.getByText("Pubblicato", { exact: true })).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();
});

test("closing an editor with unsaved changes asks for confirmation", async ({ page }) => {
  await page.goto("./#/staff?edit=new");
  const d = dialog(page);
  await d.getByLabel("Nome").fill("Modifica non salvata");
  let asked = false;
  page.once("dialog", async (confirm) => {
    asked = true;
    await confirm.dismiss();
  });
  await d.getByRole("button", { name: "Chiudi" }).click();
  expect(asked).toBe(true);
  await expect(d.getByLabel("Nome")).toHaveValue("Modifica non salvata");
});

test("knockout draw requires choosing the qualified team, then publishes", async ({ page }) => {
  await page.goto("./#/league?tab=tabellone");
  await page.getByRole("button", { name: /Quarto 1/ }).click();
  const d = dialog(page);
  for (const label of await d.getByRole("button", { name: /: più$/ }).all()) await label.click();
  await expect(d.getByText("Qualificata")).toBeVisible();
  const team = (await d.getByRole("radio").first().textContent())!.trim();
  await d.getByRole("radio").first().click();
  await d.getByRole("button", { name: "Pubblica" }).click();
  await expect(page.getByText("Pubblicato", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Quarto 1/ })).toContainText(team);
});

test("edit the League rules and publish", async ({ page }) => {
  await page.goto("./#/league?tab=regolamento");
  const text = `Regolamento aggiornato dal test ${Date.now()}.`;
  const intro = page.getByLabel("Introduzione");
  await intro.fill(text);
  await page.getByRole("button", { name: "Pubblica" }).click();
  await expect(page.getByText("Pubblicato", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Introduzione")).toHaveValue(text);
});

test("up to 12 players called up; no report tab, no opponents tab for U23", async ({ page }) => {
  await page.goto("./#/partite/prima?edit=new");
  let d = dialog(page);
  await expect(d.getByRole("tab", { name: "Tabellino" })).toHaveCount(0);
  await expect(d.getByRole("tab", { name: "Avversari" })).toHaveCount(1);
  await d.getByRole("tab", { name: "Avversari" }).click();
  await expect(d.getByText("Marcatori avversari")).toHaveCount(0);
  await d.getByRole("tab", { name: /Convocati/ }).click();
  await d.getByRole("button", { name: "Aggiungi" }).click();
  const picker = dialog(page);
  for (let i = 0; i < 14; i++) await picker.locator("button:has(span.tabular)").nth(i).click();
  await picker.getByRole("button", { name: /Fatto/ }).click();
  await expect(d.getByText("Convocati(12/12)")).toBeVisible();
  await expect(d.getByRole("button", { name: "Aggiungi" })).toBeDisabled();
  await page.keyboard.press("Escape");
  page.once("dialog", (c) => c.accept());
  await page.goto("./#/partite/u23?edit=new");
  d = dialog(page);
  await expect(d.getByRole("tab", { name: "Avversari" })).toHaveCount(0);
  await expect(d.getByRole("tab", { name: "Tabellino" })).toHaveCount(0);
});

test("knockout games accept scorers from the two teams", async ({ page }) => {
  await page.goto("./#/league?tab=tabellone");
  await page.getByRole("button", { name: /Quarto 2/ }).click();
  const d = dialog(page);
  await d.getByRole("button", { name: /: più$/ }).first().click();
  await d.getByRole("button", { name: /: più$/ }).first().click();
  await d.getByRole("button", { name: "Gol", exact: true }).first().click();
  const picker = dialog(page);
  const groups = await picker.locator("p.uppercase").allTextContents();
  expect(groups.some((g) => g.startsWith("Rosa "))).toBe(true);
  await picker.getByText("Autogol", { exact: true }).click();
  await d.getByRole("button", { name: "Pubblica" }).click();
  await expect(page.getByText("Pubblicato", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Quarto 2/ })).toContainText("Autogol");
});
