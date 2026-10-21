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
    await firstCard.locator('[data-action="award"]').click();
    await expect(firstCard.locator(".score")).toHaveText("1");

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
    // color names can be compound ("rosa chicle"), so accept accented words
    await expect(page.locator("#winner-name")).toContainText(/^[\p{L} ]+$/u);

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
    const names = await cards.locator(".card-head h2").allTextContents();

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

  test("end of time produces non groups awards", async ({ page }) => {
    // Fake the page clock so the 5 s countdown can be driven deterministically.
    await page.clock.install();
    await setupContest(page, 2, ["ana"]);
    await expect(page.locator("#status-line")).toHaveText("2 grupos · 1 jugador");
    await launchQuestion(page, "¿Cuál es la capital de Asturias?", 5);
    await page.clock.runFor(1000);
    const first = page.locator("#board .card").first();
    await first.locator('[data-action="award"]').click();
    await expect(first.locator(".score")).toHaveText("1");

    let result = page.locator("#q-result").first();
    await expect(result).toContainText("Punto para ");
    await expect(result).not.toHaveClass("q-bad");
    await expect(result).toHaveClass("q-ok");

    // generate second question
    await page.locator("#next-question").click();
    await launchQuestion(page, "¿Cuál es la capital de Toledo?", 5);

    // expire the 5 s question for real (6 s of fake clock)
    await page.clock.runFor(6000);
    result = page.locator("#q-result");
    await expect(result).toHaveCount(1);
    result = result.first();
    // the stale award of the previous question must NOT mask this round's
    // own time-out message (dictionary string includes the glyph and ¡!)
    await expect(result).toHaveText("⏱ ¡Tiempo!");
    await expect(result).toHaveClass("q-bad");
    await expect(result).not.toHaveClass("q-ok");
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
    const names = await cards.locator(".card-head h2").allTextContents();
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

// === Paleta de colores: cálculo, reflejo y nombre en la interfaz ===
// All cases use a FIXED startHue (10) so the wheel positions are golden
// values, hand-verified against the formula round((h + i*360/n) % 360) and
// the bucket table floor(hue/30):
//   10→"rojo coral" · 100→"verde lima" · 130→"verde neón" · 190→"cian
//   eléctrico" · 280→"púrpura intenso" · 250→"azul eléctrico"
test.describe("paleta de colores", () => {
  // Serialize a hand-built setup/playing state at a fixed hue.
  function sessionState(phase, startHue, groups) {
    return {
      startedAt: 1750000000000,
      phase,
      startHue,
      groups: groups.map((g, i) => ({
        id: `g${i}`,
        name: g.name ?? null, // null = derive from the hue bucket
        members: g.members ?? [],
        points: 0,
      })),
      round: { question: "", seconds: 30, phase: "draft", undoLog: [], expired: false, logStart: 0 },
    };
  }

  const HUE_TO_RGB = (line) => `hsl(${line}, 90%, 60%)`;
  // accept the computed color in either serialization (hsl or resolved rgb);
  // rgb is the CSS sRGB math for hsl(hue, 90%, 60%), rounded per component.
  async function expectSwatchColors(page, hues) {
    return page.locator("#setup-groups .setup-swatch").evaluateAll((els, hues) => {
      const rgbFromHsl = (h) => {
        h = ((h % 360) + 360) % 360;
        const s = 0.9, l = 0.6;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        const t =
          h < 60 ? [c, x, 0] :
          h < 120 ? [x, c, 0] :
          h < 180 ? [0, c, x] :
          h < 240 ? [0, x, c] :
          h < 300 ? [x, 0, c] : [c, 0, x];
        return t.map((v) => Math.round((v + m) * 255));
      };
      return els.every((el, i) => {
        const h = hues[i];
        const s = getComputedStyle(el).backgroundColor;
        if (/^hsl\(/.test(s)) {
          const nums = s.match(/[\d.]+/g).map(Number);
          return nums.length >= 3 && nums[1] === 90 && nums[2] === 60 &&
            Math.abs(nums[0] - h) <= 0.01;
        }
        if (s.includes("rgb")) {
          const nums = s.match(/[\d.]+/g).map(Number).slice(0, 3);
          return nums.every((v, j) => Math.abs(v - rgbFromHsl(h)[j]) <= 1);
        }
        return false;
      });
    }, hues);
  }

  test("al fijar 4 grupos la rueda se calcula, se pinta y se nombra bien", async ({ page }) => {
    await page.addInitScript((state) => {
      window.localStorage.setItem("contestBoard:current", JSON.stringify(state));
    }, sessionState("setup", 10, [{}, {}]));
    await page.goto("/");
    await page.locator("#continue-session").click();
    await page.locator("#view-setup").waitFor({ state: "visible" });

    await page.locator("#group-count").fill("4");
    await page.locator("#group-count").dispatchEvent("change");

    // hues colorHue(10, 4, i) = [10, 100, 190, 280] → buckets 0/3/6/9
    const expected = ["rojo coral", "verde lima", "cian eléctrico", "púrpura intenso"];
    await expect(page.locator("#setup-groups input.setup-group-name")).toHaveCount(4);
    const names = await page.locator("#setup-groups input.setup-group-name").evaluateAll(
      (els) => els.map((e) => e.value),
    );
    expect(names).toEqual(expected);
    // the swatch mirrors colorFor: hsl(hue, 90%, 60%) per group
    const ok = await expectSwatchColors(page, [10, 100, 190, 280]);
    expect(ok).toBe(true);
  });

  test("al reducir los automatismos re-derivan el nombre y el personalizado se conserva", async ({ page }) => {
    // 3 groups on the hue-10 wheel carry these auto names (buckets 0/4/8);
    // "Bravo" is teacher-set, so the resize must never touch it.
    await page.addInitScript((state) => {
      window.localStorage.setItem("contestBoard:current", JSON.stringify(state));
    }, sessionState("setup", 10, [
      { name: "rojo coral", members: ["ana"] },
      { name: "Bravo", members: ["brie"] },
      { name: "azul eléctrico", members: ["carl"] },
    ]));
    await page.goto("/");
    await page.locator("#continue-session").click();
    await page.locator("#view-setup").waitFor({ state: "visible" });

    await page.locator("#group-count").fill("2");
    await page.locator("#group-count").dispatchEvent("change");

    // survivors: g0 re-derives from the 2-group wheel (hue 10 → rojo coral),
    // "Bravo" keeps the teacher's name; the third group folds away.
    const inputs = page.locator("#setup-groups input.setup-group-name");
    await expect(inputs).toHaveCount(2);
    const names = await inputs.evaluateAll((els) => els.map((e) => e.value));
    expect(names).toEqual(["rojo coral", "Bravo"]);
    const ok = await expectSwatchColors(page, [10, 190]);
    expect(ok).toBe(true);

    // nobody was lost in the fold: every name is still somewhere
    const members = await page.locator("#setup-groups .setup-members-list").evaluateAll(
      (lists) => lists.flatMap((l) => [...l.querySelectorAll("li span")].map((s) => s.textContent)),
    );
    expect(members.sort()).toEqual(["ana", "brie", "carl"].sort());
  });

  test("el tablero en juego pinta cada carta con su hue y su nombre", async ({ page }) => {
    await page.addInitScript((state) => {
      window.localStorage.setItem("contestBoard:current", JSON.stringify(state));
    }, sessionState("playing", 10, [{}, {}, {}, {}]));
    await page.goto("/");
    await page.locator("#continue-session").click();
    await page.locator("#view-play").waitFor({ state: "visible" });

    // hues [10, 100, 190, 280] in DOM order, names from the bucket table
    const expected = ["rojo coral", "verde lima", "cian eléctrico", "púrpura intenso"];
    const cards = page.locator("#board .card");
    await expect(cards).toHaveCount(4);
    const names = await cards.locator(".card-head h2").allTextContents();
    expect(names).toEqual(expected);
    const colors = await cards.evaluateAll((els) =>
      els.flatMap((el) => [
        el.style.getPropertyValue("--team-color"),
        el.style.borderTop,
      ]),
    );
    // --team-color keeps the authored hsl(); the borderTop shorthand may be
    // flushed by the engine as resolved rgb(...) of the same color.
    const rgbOf = (h) => {
      h = ((h % 360) + 360) % 360;
      const s = 0.9, l = 0.6;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - c / 2;
      const t =
        h < 60 ? [c, x, 0] :
        h < 120 ? [x, c, 0] :
        h < 180 ? [0, c, x] :
        h < 240 ? [0, x, c] :
        h < 300 ? [x, 0, c] : [c, 0, x];
      return t.map((v) => Math.round((v + m) * 255));
    };
    const hues = [10, 100, 190, 280];
    for (let i = 0; i < hues.length; i++) {
      const [r, g, b] = rgbOf(hues[i]);
      expect(colors[2 * i]).toBe(HUE_TO_RGB(hues[i]));
      expect(colors[2 * i + 1]).toMatch(
        new RegExp(
          `^10px solid (hsl\\(${hues[i]}, 90%, 60%\\)|rgb\\(${r}, ${g}, ${b}\\))$`,
        ),
      );
    }
  });
});
