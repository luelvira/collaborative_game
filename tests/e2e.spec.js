import { test, expect } from "@playwright/test";

test("home shows Continue (disabled with no save) and Fresh opens setup", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#view-home")).toBeVisible();
  await expect(page.locator("#view-setup")).toBeHidden();
  await expect(page.locator("#view-play")).toBeHidden();

  await expect(page.locator("#continue-session")).toBeDisabled();
  await expect(page.locator("#fresh-session")).toBeEnabled();
  await expect(page.locator("#history")).toBeHidden();

  await page.locator("#fresh-session").click();
  await expect(page.locator("#view-setup")).toBeVisible();
  await expect(page.locator("#view-home")).toBeHidden();
});

test("setup: choose N, name groups, add players, start contest", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fresh-session").click();

  // nothing renders until N is picked (fresh setup has no groups)
  await expect(page.locator("#setup-groups input.setup-group-name")).toHaveCount(0);
  const groupCount = page.locator("#group-count");
  await groupCount.fill("3");
  await groupCount.dispatchEvent("change");
  const nameInputs = page.locator("#setup-groups input.setup-group-name");
  await expect(nameInputs).toHaveCount(3);
  await expect(groupCount).toHaveAttribute("min", "2")
  await expect(groupCount).toHaveAttribute("max", "10")

  // rename the first group
  const first = nameInputs.first();
  await first.fill("Alpha");
  await first.dispatchEvent("change");

  // add players
  await page.locator("#user-name").fill("alice");
  await page.locator("#add-user").click();
  await page.locator("#user-name").fill("bob");
  await page.locator("#add-user").click();
  await expect(page.locator("#setup-groups li span", { hasText: "alice" }).first()).toBeVisible();

  // start contest
  await page.locator("#start-contest").click();
  await expect(page.locator("#view-play")).toBeVisible();
  const cards = page.locator("#board .card");
  await expect(cards).toHaveCount(3);
});

test("setup: uses the same balanced row layout as the board", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fresh-session").click();

  const groupCount = page.locator("#group-count");
  await groupCount.fill("10");
  await groupCount.dispatchEvent("change");

  const nameInputs = page.locator("#setup-groups input.setup-group-name");
  await expect(nameInputs).toHaveCount(10);
  // same balanced ≤3-per-row split: 10 → 3 on the first row
  await expect(page.locator('.board-row[data-row="0"] input.setup-group-name')).toHaveCount(3);
  await expect(page.locator('.board-row[data-row="1"] input.setup-group-name')).toHaveCount(3);
  await expect(page.locator('.board-row[data-row="2"] input.setup-group-name')).toHaveCount(2);
  await expect(page.locator('.board-row[data-row="3"] input.setup-group-name')).toHaveCount(2);
});

test("board rows: 10 groups split 3 + 3 + 2 + 2 across centered rows", async ({ page }) => {
  await page.goto("/");
  await page.addInitScript(() => {
    const state = {
      startedAt: Date.now(),
      phase: "playing",
      startHue: 180,
      groups: Array.from({ length: 10 }, (_, i) => ({
        id: `g${i}`,
        name: `G${i}`,
        members: ["p"],
        points: 0,
      })),
    };
    localStorage.setItem("contestBoard:current", JSON.stringify(state));
  });
  await page.goto("/");
  await page.locator("#continue-session").click();
  await page.locator("#view-play").waitFor({ state: "visible" });

  const row0 = page.locator('.board-row[data-row="0"] .card');
  const row1 = page.locator('.board-row[data-row="1"] .card');
  const row2 = page.locator('.board-row[data-row="2"] .card');
  const row3 = page.locator('.board-row[data-row="3"] .card');
  await expect(row0).toHaveCount(3);
  await expect(row1).toHaveCount(3);
  await expect(row2).toHaveCount(2);
  await expect(row3).toHaveCount(2);
});

test("board rows: 5 groups split 3 + 2 across two centered rows", async ({ page }) => {
  await page.goto("/");
  await page.addInitScript(() => {
    const state = {
      startedAt: Date.now(),
      phase: "playing",
      startHue: 180,
      groups: Array.from({ length: 5 }, (_, i) => ({
        id: `g${i}`,
        name: `G${i}`,
        members: ["p"],
        points: 0,
      })),
    };
    localStorage.setItem("contestBoard:current", JSON.stringify(state));
  });
  await page.goto("/");
  await page.locator("#continue-session").click();
  await page.locator("#view-play").waitFor({ state: "visible" });

  const row0 = page.locator('.board-row[data-row="0"] .card');
  const row1 = page.locator('.board-row[data-row="1"] .card');
  await expect(row0).toHaveCount(3);
  await expect(row1).toHaveCount(2);
});

test("play board is score-only, end archives and returns home", async ({ page }) => {
  await page.goto("/");
  await page.addInitScript(() => {
    const state = {
      startedAt: Date.now(),
      phase: "playing",
      startHue: 180,
      groups: [
        { id: "g0", name: "Alpha", members: ["p1"], points: 1 },
        { id: "g1", name: "Bravo", members: ["p2"], points: 0 },
      ],
    };
    localStorage.setItem("contestBoard:current", JSON.stringify(state));
  });
  await page.goto("/");
  await page.locator("#continue-session").click();
  await page.locator("#view-play").waitFor({ state: "visible" });

  // custom points input must be gone
  await expect(page.locator("#board .card [data-custom-input]")).toHaveCount(0);

  // +1 works and persists the score
  const firstCard = page.locator("#board .card").first();
  await firstCard.locator('.points-row [data-delta="1"]').click();
  await expect(firstCard.locator(".score")).toHaveText("2");

  // end contest -> winner overlay
  await page.locator("#end-contest").click();
  await expect(page.locator("#winner")).toBeVisible();
  await expect(page.locator("#winner-name")).toHaveText(/Alpha/);

  // reset archives and returns home (accept the confirm dialog)
  page.once("dialog", (d) => d.accept());
  await page.locator("#reset").click();
  await expect(page.locator("#winner")).toBeHidden();
  await expect(page.locator("#view-home")).toBeVisible();

  // history now shows the archived play
  await expect(page.locator("#history")).toBeVisible();
  await expect(page.locator("#history")).toContainText("Alpha");

  // current key now holds the fresh setup state, so Continue is enabled again
  await expect(page.locator("#continue-session")).toBeEnabled();
});

test("board uses two .board-row containers and centered rows", async ({ page }) => {
  await page.goto("/");
  await page.addInitScript(() => {
    const state = {
      startedAt: Date.now(),
      phase: "playing",
      startHue: 180,
      groups: Array.from({ length: 4 }, (_, i) => ({
        id: `g${i}`,
        name: `G${i}`,
        members: ["p"],
        points: 0,
      })),
    };
    localStorage.setItem("contestBoard:current", JSON.stringify(state));
  });
  await page.goto("/");
  await page.locator("#continue-session").click();
  await page.locator("#view-play").waitFor({ state: "visible" });

  await expect(page.locator(".board-row")).toHaveCount(2);
  await expect(page.locator('.board-row[data-row="0"] .card')).toHaveCount(2);
  await expect(page.locator('.board-row[data-row="1"] .card')).toHaveCount(2);
});

test("decorative stripes live in a non-scrolling layer (scroll fluidity)", async ({ page }) => {
  await page.goto("/");
  // Root cause: the -18deg repeating stripe gradient, painted as part of the
  // scroll-tied body background, is re-rasterized on every scroll and makes
  // the page (and its animations) feel slow on low-end machines. The pattern
  // must be rasterized once inside a fixed-position layer instead.
  const styles = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const before = getComputedStyle(document.body, "::before");
    return {
      bodyImage: body.backgroundImage,
      beforePosition: before.position,
      beforeImage: before.backgroundImage,
    };
  });
  expect(styles.bodyImage).not.toContain("repeating-linear-gradient");
  expect(styles.beforePosition).toBe("fixed");
  expect(styles.beforeImage).toContain("repeating-linear-gradient");
});

test("board uses one .board-row containers and centered rows", async ({ page }) => {
  await page.goto("/");
  await page.addInitScript(() => {
    const state = {
      startedAt: Date.now(),
      phase: "playing",
      startHue: 180,
      groups: Array.from({ length: 2 }, (_, i) => ({
        id: `g${i}`,
        name: `G${i}`,
        members: ["p"],
        points: 0,
      })),
    };
    localStorage.setItem("contestBoard:current", JSON.stringify(state));
  });
  await page.goto("/");
  await page.locator("#continue-session").click();
  await page.locator("#view-play").waitFor({ state: "visible" });

  await expect(page.locator(".board-row")).toHaveCount(1);
  await expect(page.locator('.board-row[data-row="0"] .card')).toHaveCount(2);
});
