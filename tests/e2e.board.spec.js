import { test, expect } from "@playwright/test";

// Start every scenario from a pristine board for this page origin, then go
// home -> setup through the new game button.
test.describe("contest board end-to-end", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      for (const key of ["contestBoard:current", "contestBoard:history"]) {
        window.localStorage.removeItem(key);
      }
    });
    await page.reload();
    await page.locator("#fresh-session").click();
    await expect(page.locator("#view-setup")).toBeVisible();
  });

  async function setupContest(page, groups, players) {
    await page.locator("#group-count").fill(String(groups));
    await page.locator("#group-count").dispatchEvent("change");
    await expect(page.locator("#setup-groups input.setup-group-name")).toHaveCount(groups);
    for (const name of players) {
      await page.fill("#user-name", name);
      await page.locator("#add-user").click();
    }
    await page.locator("#start-contest").click();
    await expect(page.locator("#view-play")).toBeVisible();
  }

  test("setup creates N color-named groups with zero typing", async ({ page }) => {
    await page.locator("#group-count").fill("2");
    await page.locator("#group-count").dispatchEvent("change");
    const names = await page
      .locator("#setup-groups input.setup-group-name")
      .evaluateAll((els) => els.map((e) => e.value));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    // names come from the wheel buckets, not empty placeholders
    for (const n of names) expect(n.trim().length).toBeGreaterThan(0);
  });

  test("assigns users to low-population groups, no group starves", async ({ page }) => {
    // add 7 players in setup with 3 groups; members distribute anti-starving
    await page.locator("#group-count").fill("3");
    await page.locator("#group-count").dispatchEvent("change");
    const players = ["ana", "brie", "carl", "dana", "evan", "gus", "hugo"];
    for (const name of players) {
      await page.fill("#user-name", name);
      await page.locator("#add-user").click();
    }
    const counts = await page.locator("#setup-groups").evaluateAll((sections) =>
      sections.map((c) => c.querySelectorAll(".setup-members-list li:not(.empty-hint)").length),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(7);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  test("awards points with quick buttons in play; refresh keeps score", async ({ page }) => {
    await setupContest(page, 2, ["ana"]);
    const firstCard = page.locator("#board .card").first();
    await firstCard.locator('.points-row [data-delta="1"]').click();
    await firstCard.locator('.points-row [data-delta="-1"]').click();
    await firstCard.locator('.points-row [data-delta="1"]').click();
    await expect(firstCard.locator(".score")).toHaveText("1");

    // no custom points field in play
    await expect(page.locator("#board .card [data-custom-input]")).toHaveCount(0);

    await page.reload();
    await page.locator("#continue-session").click();
    await expect(page.locator("#view-play .card").first().locator(".score")).toHaveText("1");
  });

  test("end contest announces the winner and archives the play back home", async ({ page }) => {
    await setupContest(page, 2, ["ana", "brie"]);
    await page.locator("#board .card").first().locator('.points-row [data-delta="1"]').click();
    await page.locator("#end-contest").click();

    await expect(page.locator("#winner")).toBeVisible();
    await expect(page.locator("#winner-name")).toContainText(/^\w+$/);

    // frozen board locks the buttons
    const allCardButtonsDisabled = await page
      .locator("#board .card button")
      .evaluateAll((els) => els.every((b) => b.disabled));
    expect(allCardButtonsDisabled).toBe(true);

    page.once("dialog", (d) => d.accept());
    await page.locator("#reset").click();
    await expect(page.locator("#winner")).toBeHidden();
    await expect(page.locator("#view-home")).toBeVisible();
    await expect(page.locator("#history")).toBeVisible();
    await expect(page.locator("#history li")).toHaveCount(1);
    await expect(page.locator("#history li")).toContainText("Winner");
  });

  test("roster is locked during play: no add-user in the play view", async ({ page }) => {
    await setupContest(page, 2, ["ana"]);
    // play view has no add-user control visible, no member/group edit buttons
    await expect(page.locator("#view-play #add-user")).toHaveCount(0);
    await expect(page.locator("#board .card .rm")).toHaveCount(0);
    await expect(page.locator("#board .card .rm-group")).toHaveCount(0);
  });

  test("shows a visible toast when a handler crashes instead of dying silently", async ({ page }) => {
    await page.waitForFunction(() => window.__contestApi);
    await page.evaluate(() => {
      window.__contestApi.setGroupCount = () => {
        throw new TypeError("boom");
      };
    });
    await page.locator("#group-count").fill("2");
    await page.locator("#group-count").dispatchEvent("change");
    await expect(page.locator("#toast.show")).toBeVisible();
    await expect(page.locator("#toast.show")).toContainText("boom");
  });

  test("board layout: 6 groups split 3 + 3 across two rows", async ({ page }) => {
    await setupContest(page, 6, ["p"]);
    await expect(page.locator('.board-row[data-row="0"] .card')).toHaveCount(3);
    await expect(page.locator('.board-row[data-row="1"] .card')).toHaveCount(3);
  });
});
