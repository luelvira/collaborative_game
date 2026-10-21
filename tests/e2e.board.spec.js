import { test, expect } from "@playwright/test";

// Drive a contest to the play view from wherever the describe's beforeEach
// leaves the page (it needs the setup screen in front of it).
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

// Start every scenario from a pristine board for this page origin, then go
// home -> setup through the new game button.
test.describe("contest board end-to-end", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      for (const key of ["contestBoard:current", "contestBoard:history", "contestBoard:sound"]) {
        window.localStorage.removeItem(key);
      }
    });
    await page.reload();
    await page.locator("#fresh-session").click();
    await expect(page.locator("#view-setup")).toBeVisible();
  });

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

  test("awards points with the single award button in play; refresh keeps score", async ({ page }) => {
    await setupContest(page, 2, ["ana"]);
    // Spanish copy: status line with correct Spanish plurals
    await expect(page.locator("#status-line")).toHaveText("2 grupos · 1 jugador");
    const firstCard = page.locator("#board .card").first();
    // the −1 button is gone; one award button (+1) is the whole points-row
    await expect(page.locator('[data-delta="-1"]')).toHaveCount(0);
    await firstCard.locator('[data-action="award"]').click();
    await expect(firstCard.locator(".score")).toHaveText("1");

    // no custom points field in play
    await expect(page.locator("#board .card [data-custom-input]")).toHaveCount(0);

    await page.reload();
    await page.locator("#continue-session").click();
    await expect(page.locator("#view-play .card").first().locator(".score")).toHaveText("1");
  });

  test("sound toggle persists glyph and state across a reload", async ({ page }) => {
    await setupContest(page, 2, ["ana"]);
    const toggle = page.locator("#sound-toggle");
    // boots ON per spec (no stored preference)
    await expect(toggle).toHaveAttribute("data-sound", "on");
    await expect(toggle).toHaveText("🔊");

    // off → survives a full page reload (glyph + data-sound + storage)
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-sound", "off");
    await expect(toggle).toHaveText("🔇");
    expect(await page.evaluate(() => window.localStorage.getItem("contestBoard:sound"))).toBe("off");
    await page.reload();
    await page.locator("#continue-session").click();
    await expect(page.locator("#view-play")).toBeVisible();
    const reloaded = page.locator("#sound-toggle");
    await expect(reloaded).toHaveAttribute("data-sound", "off");
    await expect(reloaded).toHaveText("🔇");

    // back on → also persists
    await reloaded.click();
    await page.reload();
    await page.locator("#continue-session").click();
    await expect(page.locator("#sound-toggle")).toHaveAttribute("data-sound", "on");
  });

  test("end contest announces the winner and archives the play back home", async ({ page }) => {
    await setupContest(page, 2, ["ana", "brie"]);
    await page.locator("#board .card").first().locator('[data-action="award"]').click();
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
    await expect(page.locator("#history li")).toContainText("Ganador:");
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

// Franja de pregunta: máquina de estados del concurso en la vista de juego
// (borrador → en directo → puntuado/expirado → siguiente pregunta).
test.describe("franja de pregunta en la vista de juego", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      for (const key of ["contestBoard:current", "contestBoard:history", "contestBoard:sound"]) {
        window.localStorage.removeItem(key);
      }
    });
    await page.reload();
    await page.locator("#fresh-session").click();
    await expect(page.locator("#view-setup")).toBeVisible();
  });

  async function launchQuestion(page, question, seconds) {
    await page.locator("#q-input").fill(question);
    await page.locator("#q-seconds").fill(String(seconds));
    await page.locator("#launch-question").click();
    await expect(page.locator("#q-live")).toBeVisible();
    await expect(page.locator("#q-text")).toHaveText(question);
  }

  test("la pregunta aparece con cuenta atrás y se para al puntuar", async ({ page }) => {
    await setupContest(page, 2, ["ana"]);
    await expect(page.locator("#q-strip")).toBeVisible();
    await expect(page.locator("#q-draft")).toBeVisible();
    // empty draft: the strip blocks the launch with a toast
    await page.locator("#launch-question").click();
    await expect(page.locator("#toast.show")).toContainText("Pregunta vacía");

    await launchQuestion(page, "¿Cuál es la capital de Perú?", 5);
    const timer = page.locator("#q-timer");
    const before = Number(await timer.textContent());
    expect(before).toBeGreaterThanOrEqual(4);
    await page.waitForTimeout(1100);
    expect(Number(await timer.textContent())).toBeLessThan(before);

    // awarding the first card stops the countdown for good
    const firstCard = page.locator("#board .card").first();
    await firstCard.locator('[data-action="award"]').click();
    await expect(page.locator("#q-after")).toBeVisible();
    await expect(page.locator("#q-result")).toContainText("¡Punto para ");
    await expect(page.locator("#q-live")).toBeHidden();
    await expect(firstCard.locator(".score")).toHaveText("1");
    await page.waitForTimeout(2000);
    await expect(page.locator("#q-live")).toBeHidden();
  });

  test("varios puntos en la misma pregunta repiten celebración y actualizan el mensaje", async ({ page }) => {
    await setupContest(page, 2, ["ana"]);
    await launchQuestion(page, "¿Quién escribió El Quijote?", 5);
    const cards = page.locator("#board .card");
    const names = await cards.locator(".card-head h3").allTextContents();

    await cards.nth(0).locator('[data-action="award"]').click();
    await expect(page.locator("#q-result")).toHaveText(`¡Punto para ${names[0]}!`);
    await cards.nth(1).locator('[data-action="award"]').click();
    await expect(page.locator("#q-result")).toHaveText(`¡Punto para ${names[1]}!`);
    await expect(cards.nth(0).locator(".score")).toHaveText("1");
    await expect(cards.nth(1).locator(".score")).toHaveText("1");
  });

  test("deshacer revierte el ultimo punto", async ({ page }) => {
    await setupContest(page, 2, ["ana"]);
    await launchQuestion(page, "¿Cuántos continentes hay?", 5);
    const firstCard = page.locator("#board .card").first();
    await firstCard.locator('[data-action="award"]').click();
    await expect(firstCard.locator(".score")).toHaveText("1");
    await expect(page.locator("#undo-award")).toBeEnabled();

    await page.locator("#undo-award").click();
    // the score returns to its previous value; the strip message loses the
    // award text (its source) and nothing is left to undo
    await expect(firstCard.locator(".score")).toHaveText("0");
    await expect(page.locator("#q-result")).toHaveText("");
    await expect(page.locator("#undo-award")).toBeDisabled();
  });

  test("la pregunta sobrevive a un refresco y el tiempo reinicia", async ({ page }) => {
    await setupContest(page, 2, ["ana"]);
    await launchQuestion(page, "¿En qué año estamos?", 30);
    await page.waitForTimeout(1000);
    await page.reload();
    await page.locator("#continue-session").click();
    await expect(page.locator("#view-play")).toBeVisible();
    await expect(page.locator("#q-live")).toBeVisible();
    await expect(page.locator("#q-text")).toHaveText("¿En qué año estamos?");
    // Solución de la revisión final (Finding 4): el primer tick pinta 29 en
    // máquinas lentas; aceptar 30 o 29 y no romper por ruido de reloj.
    await expect(page.locator("#q-timer")).toHaveText(/^(30|29)$/);
  });

  test("tonos de cuenta atras: 5 s arranca ya en rojo y pulsa", async ({ page }) => {
    await setupContest(page, 2, ["ana"]);
    // A 5 s question is born inside the danger window: no need to wait for
    // the mid-round warn tone.
    await launchQuestion(page, "¿Color primario del Shanghai Skyline?", 5);
    await expect(page.locator("#q-timer")).toHaveClass(/q-danger/);
    await expect(page.locator("#q-timer")).toHaveClass(/q-pulse/);
    await expect(page.locator("#q-bar")).toHaveClass(/q-danger/);
    // The container breathes with the pill.
    await expect(page.locator(".q-bar")).toHaveClass(/q-pulse/);
  });

  test("expiracion: franja roja, deshacer inerte y puntuar a mano celebra", async ({ page }) => {
    await setupContest(page, 2, ["ana"]);
    await launchQuestion(page, "¿Capital de Mongolia?", 5);
    // The 200 ms tick reaches zero inside the 5 s budget; give it 6.5 s.
    await page.waitForTimeout(6500);
    await expect(page.locator("#q-live")).toBeHidden();
    await expect(page.locator("#q-after")).toBeVisible();
    await expect(page.locator("#q-result")).toHaveText("⏱ ¡Tiempo!");
    // expired accent: the strip carries the phase in data-e (answered uses
    // the same marker, in green) — set by renderStrip from round.phase.
    await expect(page.locator("#q-strip")).toHaveAttribute("data-e", "expired");
    // Nothing was awarded this round: the undo chip sits disabled.
    await expect(page.locator("#undo-award")).toBeDisabled();

    // Manual award from expired celebrates like from live, and the strip
    // switches to the answered (green) accent while the round stays answered.
    const cards = page.locator("#board .card");
    const names = await cards.locator(".card-head h3").allTextContents();
    await cards.nth(0).locator('[data-action="award"]').click();
    await expect(page.locator("#q-result")).toHaveText(`¡Punto para ${names[0]}!`);
    await expect(cards.nth(0).locator(".score")).toHaveText("1");
    await expect(page.locator("#q-strip")).toHaveAttribute("data-e", "answered");
    await expect(page.locator("#q-live")).toBeHidden();
    await expect(page.locator("#q-after")).toBeVisible();
  });

  test("sesion antigua sin ronda sigue cargando", async ({ page }) => {
    await page.addInitScript(() => {
      const legacy = {
        startedAt: Date.now(),
        phase: "playing",
        startHue: 180,
        groups: [
          { id: "ga", name: "azul", members: ["ana"], points: 0 },
          { id: "gb", name: "rojo", members: ["brie"], points: 0 },
        ],
      };
      window.localStorage.setItem("contestBoard:current", JSON.stringify(legacy));
    });
    await page.goto("/");
    await page.locator("#continue-session").click();
    await expect(page.locator("#view-play")).toBeVisible();
    await expect(page.locator("#board .card")).toHaveCount(2);
    // the redesign hydrates the missing round into the draft strip
    await expect(page.locator("#q-strip")).toBeVisible();
    await expect(page.locator("#q-draft")).toBeVisible();
  });
});
