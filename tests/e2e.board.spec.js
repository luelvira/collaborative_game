import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = "file://" + path.resolve(here, "..", "index.html");

// Start every scenario from a pristine board for this page origin.
const resetStorage = `
  for (const key of ["contestBoard:current", "contestBoard:history"]) {
    window.localStorage.removeItem(key);
  }
`;

const click = async (page, sel) => page.locator(sel).first().click();
const cardTitles = (page) =>
  page.locator("#board .card .card-head h3").allTextContents();

test.describe("contest board end-to-end (double-click style, file://)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(pageUrl);
    await page.evaluate(resetStorage);
    await page.reload(); // boot on a clean slate
  });

  test("adds color-named groups with zero typing", async ({ page }) => {
    await click(page, "#add-group");
    await expect(page.locator("#board .card")).toHaveCount(1);
    await click(page, "#add-group");
    const names = await cardTitles(page);
    expect(names).toHaveLength(2);
    // two distinct wheel buckets -> distinct color names
    expect(new Set(names).size).toBe(2);
  });

  test("assigns users to low-population groups, no group starves", async ({ page }) => {
    for (let i = 0; i < 3; i++) await click(page, "#add-group");
    // wait for the three cards to be present
    await expect(page.locator("#board .card")).toHaveCount(3);
    for (const name of ["ana", "brie", "carl", "dana", "evan", "gus", "hugo"]) {
      await page.fill("#user-name", name);
      await click(page, "#add-user");
    }
    const counts = await page.locator("#board .card").evaluateAll((cards) =>
      cards.map((c) => c.querySelectorAll(".members li").length),
    );
    // 7 users into 3 groups with min-size assignment: max - min <= 1
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(7);
  });

  test("awards points with quick buttons and a custom amount, refreshes keep it", async ({ page }) => {
    for (let i = 0; i < 2; i++) await click(page, "#add-group");
    await page.fill("#user-name", "ana");
    await click(page, "#add-user");

    await click(page, '#board .card .points-row [data-delta="5"]');
    await click(page, '#board .card .points-row [data-delta="-1"]');
    const scoresBefore = await page.locator("#board .score").allTextContents();
    expect(Number(scoresBefore[0])).toBe(4);

    await page.fill("#board .card .custom-points input", "3");
    await click(page, "#board .card .custom-points button");
    expect(Number((await page.locator("#board .score").allTextContents())[0])).toBe(7);

    await page.reload(); // refresh mid-contest must restore everything
    expect(Number((await page.locator("#board .score").allTextContents())[0])).toBe(7);
  });

  test("end contest announces the winner, locks the board and archives the play", async ({ page }) => {
    for (let i = 0; i < 2; i++) await click(page, "#add-group");
    for (const n of ["ana", "brie"]) {
      await page.fill("#user-name", n);
      await click(page, "#add-user");
    }
    await click(page, '#board .card .points-row [data-delta="5"]');
    await click(page, "#end-contest");

    await expect(page.locator("#winner")).toBeVisible();
    await expect(page.locator("#winner-name")).toContainText(/^\w+$/);
    // board is frozen: every card button is disabled
    const allCardButtonsDisabled = await page
      .locator("#board .card button")
      .evaluateAll((els) => els.every((b) => b.disabled));
    expect(allCardButtonsDisabled).toBe(true);
    await expect(page.locator("#add-user")).toBeDisabled();

    await page.on("dialog", (d) => d.accept());
    await click(page, "#reset");
    await expect(page.locator("#winner")).toBeHidden();
    await expect(page.locator("#history")).toBeVisible();
    await expect(page.locator("#history li")).toHaveCount(1);
    await expect(page.locator("#history li")).toContainText("Winner");
  });

  test("shows a visible toast when a handler crashes instead of dying silently", async ({ page }) => {
    const lib = readFileSync(path.join(here, "..", "lib.js"), "utf8");
    await page.route("**/lib.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: lib + `\nglobalThis.ContestLib.addGroup = () => { throw new TypeError("boom"); };`,
      }),
    );
    await page.reload();
    await click(page, "#add-group");
    await expect(page.locator("#toast.show")).toBeVisible();
    await expect(page.locator("#toast.show")).toContainText("boom");
  });
});
