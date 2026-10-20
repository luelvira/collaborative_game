import { test, expect } from "@playwright/test";

test("home shows Continue (disabled with no save) and Fresh opens setup", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#view-home")).toBeVisible();
  await expect(page.locator("#view-setup")).toBeHidden();
  await expect(page.locator("#view-play")).toBeHidden();

  // Spanish copy dictionary (Task 5)
  await expect(page).toHaveTitle("Tablero de Concurso");
  await expect(page.locator(".home-kicker")).toHaveText("Concurso en directo para el aula");
  await expect(page.locator(".home-title")).toHaveText("Tablero de Concurso");
  await expect(page.locator(".home-sub")).toHaveText(
    "Marcador preparado para proyectar. Todo se guarda en este navegador.",
  );
  await expect(page.locator("#continue-session")).toHaveText("Continuar la última sesión");
  await expect(page.locator("#fresh-session")).toHaveText("Nueva partida");

  await expect(page.locator("#continue-session")).toBeDisabled();
  await expect(page.locator("#fresh-session")).toBeEnabled();
  await expect(page.locator("#history")).toBeHidden();

  await page.locator("#fresh-session").click();
  await expect(page.locator("#view-setup")).toBeVisible();
  await expect(page.locator("#view-home")).toBeHidden();
  await expect(page.locator("#view-setup .status")).toHaveText(
    "Elige grupos, ponles nombre y añade jugadores",
  );
});

test("setup: choose N, name groups, add players, start contest", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fresh-session").click();

  await expect(page.locator("#setup-groups input.setup-group-name")).toHaveCount(2);
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

  // +1 works and persists the score (single award button since Task 3)
  const firstCard = page.locator("#board .card").first();
  await firstCard.locator('[data-action="award"]').click();
  await expect(firstCard.locator(".score")).toHaveText("2");

  // end contest -> winner overlay
  await page.locator("#end-contest").click();
  await expect(page.locator("#winner")).toBeVisible();
  await expect(page.locator("#winner-name")).toHaveText(/Alpha/);
  // Spanish copy: podium title and runner-up line (task 5 dictionary)
  await expect(page.locator(".podium-title")).toHaveText("Ganador");
  await expect(page.locator("#runner-up")).toHaveText("Segundo puesto: Bravo (0)");
  await expect(page.locator("#status-line")).toHaveText("Concurso terminado");

  // reset archives and returns home (accept the confirm dialog)
  page.once("dialog", (d) => d.accept());
  await page.locator("#reset").click();
  await expect(page.locator("#winner")).toBeHidden();
  await expect(page.locator("#view-home")).toBeVisible();

  // history now shows the archived play
  await expect(page.locator("#history")).toBeVisible();
  await expect(page.locator("#history")).toContainText("Partidas anteriores");
  await expect(page.locator("#history")).toContainText("Ganador: Alpha");
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

test("board paints a flat dark scoreboard: no stripes, no glow", async ({ page }) => {
  await page.goto("/");
  const styles = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const before = getComputedStyle(document.body, "::before");
    const h1 = getComputedStyle(document.querySelector("#view-home .home-title"));
    return { bodyBg: body.backgroundColor, beforeImage: before.backgroundImage, h1Shadow: h1.textShadow };
  });
  expect(styles.bodyBg).toBe("rgb(10, 10, 15)");
  expect(styles.beforeImage).toBe("none");
  expect(styles.h1Shadow).toBe("none");
});

test("winner overlay is light enough to see scroll behind and scrolls itself if tall", async ({ page }) => {
  await page.goto("/");
  // Root cause: a near-opaque (0.95) fullscreen overlay makes any page scroll
  // behind it invisible, so scrolling *feels* blocked while the winner screen
  // is up. The overlay must stay translucent and be able to scroll its own
  // content on short screens instead of swallowing the document scroll.
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
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.locator("#end-contest").click();
  await page.locator("#winner").waitFor({ state: "visible" });
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  const scrolled = await page.evaluate(() => window.scrollY);

  const overlay = await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById("winner"));
    const alpha = s.backgroundColor.match(/[\d.]+\)$/)?.[0];
    return { bg: s.backgroundColor, overflow: s.overflowY };
  });
  expect(overlay.overflow).toBe("auto");
  // translucency: bg alpha below 0.9 so motion behind is perceptible
  const a = Number(overlay.bg.match(/[\d.]+/g)?.slice(-1)[0]);
  expect(a).toBeLessThan(0.9);
  // real wheel over the overlay must still move the document behind
  expect(scrolled).toBeGreaterThan(scrollBefore);
});

test("views fade in when shown", async ({ page }) => {
  await page.goto("/");
  const viewAnim = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector("#view-home"));
    return { name: s.animationName, duration: parseFloat(s.animationDuration) };
  });
  // Smoothness: a real (non-none) fade animation shorter than half a second.
  expect(viewAnim.name).not.toBe("none");
  expect(viewAnim.duration).toBeGreaterThan(0);
  expect(viewAnim.duration).toBeLessThanOrEqual(0.5);
});
