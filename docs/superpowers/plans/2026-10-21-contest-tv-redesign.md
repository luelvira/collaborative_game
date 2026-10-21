# Contest TV Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the contest board as a flat high-contrast dark "TV scoreboard" and add the per-question contest flow: ad-hoc question strip with countdown, award celebration (color flash + confetti), repeatable undo, sound toggle — all in Spanish.

**Architecture:** Pure contest-round logic joins `lib.js` (state machine of the question round + undo log, serialized with the existing session state). DOM lives in `app.js` (strip rendering, timer ticking, flash/confetti, Web Audio). `styles.css` is rewritten to the flat theme. No new dependencies.

**Tech Stack:** Vanilla ES modules, Vite, Tailwind `@import` base only, vitest (unit) + Playwright (e2e), Web Audio API.

**Spec:** `docs/superpowers/specs/2026-10-21-contest-tv-redesign-design.md` (read it before executing; the plan argues from it).

## Global Constraints

- No new dependencies or CDNs; sound via Web Audio oscillator only (no audio files).
- UI copy in Spanish, including wheel color names in `colorName()` and `lib.js` error strings surfaced in toasts.
- Round state persists with the session: `state.round` inside `contestBoard:current`; **time remaining is never persisted** — a refresh mid-question restarts the countdown at full seconds.
- Undo log: last 20 awards, across questions for the whole playing phase.
- Flash duration 800 ms; sibling dimming only during that window (performance care: one class toggle on `#board`, no per-card JS animations).
- Countdown ticks from `Date.now()` deltas (`setInterval` 200 ms), default 30 s, editable 5–300 s step 5.
- Sound persists in `localStorage["contestBoard:sound"]`, `"on"` default, toggle in play topbar.
- `prefers-reduced-motion: reduce` disables flash, confetti and strip animations (they end immediately, state still transitions).
- Colors/typography follow the spec's "Marcador nocturno" direction: flat `#0a0a0f` background, secondary text `#cfd2dc`, no gradients, no `text-shadow`, no color-glow shadows, no borders below 50% opacity; team color as a thick 10px top border per card. Exact px inside these tokens are the builder's call, must satisfy AA contrast.
- Every mutation persists the session (current behavior preserved).

## Review Focus

1. Refresh mid-live-question → question text survives, countdown restarts at full seconds, phase still `live`. (e2e in Task 3)
2. Several awards on the same question → each award replays the flash, result text updates, timer stays stopped; undo pops the most recent award across questions. (unit in Task 1, e2e in Task 3)
3. Old saved session (no `round` field) → Continue hydrates the round to draft `30 s`, board fully usable. (unit in Task 1, e2e in Task 3)
4. Timer hitting zero while an award is being clicked → transitions are one-way and idempotent: `expireRound` only `live→expired`, `awardPoints` always leaves the round in `answered`. (unit in Task 1)
5. Under lost/absent localStorage and reduced motion, the contest still runs with no exceptions — sound silently skipped, animations skipped. (unit guards in Task 4)

---

### Task 1: Round state machine in `lib.js`

**Files:**
- Modify: `src/lib.js`
- Test: `src/lib.test.js`

**Interfaces:**
- Consumes: existing `addPoints`, `endContest`, `newState`, `serialize`, `deserialize`.
- Produces (exact signatures; Task 3 relies on these):
  - `initialRound(seconds = 30)` → `{ question: "", seconds, phase: "draft", undoLog: [] }`
  - `startRound(state)` → `{ ok: true } | { error }`; only from `playing` phase + round `draft`; requires non-empty `state.round.question` (error `"Pregunta vacía"`); sets round phase `"live"`.
  - `expireRound(state)` → `{ ok: true } | { error }`; only `live` → `"expired"`; idempotent-safe (errors otherwise).
  - `awardPoints(state, id, amount = 1)` → validates like `addPoints` (must be unreachable when `state.phase !== "playing"`; amount same rules); on success: applies to points, pushes `{ groupId: id, amount }` onto `round.undoLog` (cap 20, oldest dropped), sets `round.phase = "answered"`; returns `{ ok: true } | { error }`. Error copy: `"Concurso no en juego" / "Grupo desconocido" / "Cantidad no válida"`.
  - `undoLastAward(state)` → pops the last `undoLog` entry; subtracts `amount` from that group's points; returns `{ ok: true, undone } | { error: "Nada que deshacer" }` (empty log) — no phase change.
  - `nextQuestion(state)` → `round = initialRound(round.seconds)` (question cleared, last-used seconds kept, undoLog **kept**); error `"Concurso no en juego"` unless playing.
  - `initialRound` applied by `newState()`, by `startContest()` (fresh contest), and by `endContest()` (question discarded), and in `deserialize` hydration: if parsed state lacks `round` or it has no `phase` field, attach `initialRound(30)` without touching groups/points.
  - Spanish `COLOR_NAMES` (same 30° buckets): `["rojo","naranja","amarillo","lima","verde","turquesa","cian","celeste","azul","violeta","magenta","rosa"]`.
  - Spanish error strings for existing validators that reach the UI via toasts (`"Not in setup"` → `"Fuera de la preparación"`, `Choose between…` → `"Elige entre 2 y 10 grupos"`, `"Unknown group"` → `"Grupo desconocido"`, `"Empty name"` → `"Nombre vacío"`, `"Group has members"` → `"El grupo tiene jugadores"`, `"Invalid amount"` → `"Cantidad no válida"`, `"Maximum 10 groups"` → `"Máximo 10 grupos"`, `"Contest is not running"` → `"Concurso no en juego"`).

- [ ] **Step 1: Write failing tests in `src/lib.test.js`**

Cover at minimum:
- `colorName` returns the Spanish names at bucket centers (`colorName(0) === "rojo"`, `colorName(180) === "cian"` — bucket n is index `Math.floor(normalized/30)`, so 30-wide buckets start at rojo=0, naranja=30, amarillo=60, lima=90, verde=120, turquesa=150, cian=180, celeste=210, azul=240, violeta=270, magenta=300, rosa=330).
- `newState()` has `round.phase === "draft"` and `round.seconds === 30`.
- `startRound` requires non-empty question (error `"Pregunta vacía"`), errors outside playing, and `live` after success.
- `expireRound`: `live → expired`; second call errors.
- `awardPoints`: adds the point, appends to `undoLog`, sets phase `"answered"`, works from `"live"`, from `"expired"`, and (timer never starts) from `"draft"` too; double-award on one question keeps `undoLog` length 2 and both entries in order.
- `awardPoints` cap: after 25 awards, `undoLog.length === 20` and the oldest entries are gone.
- `undoLastAward`: reverts points and pops the newest entry first (two awards + two undos → original score); errors `"Nada que deshacer"` on empty log; works on an award from a previous question (log survives `nextQuestion`).
- `nextQuestion`: question cleared, `phase === "draft"`, `seconds` keeps the previous value, `undoLog` survives.
- `endContest`: round replaced by `initialRound(30)`.
- Hydration: `deserialize(JSON.stringify(oldState))` — oldState built with `{question:"...", seconds:30}` and **no** `round` key — gains `round.phase === "draft"` and leaves groups/points untouched.

- [ ] **Step 2: Run** `npm run test:unit` → expect the new tests FAIL (functions missing)

- [ ] **Step 3: Implement** in `src/lib.js` per the Interfaces block. Translate `COLOR_NAMES` and the listed error strings. `deserialize` hydrates defensively (wrap `JSON.parse` result in the round check); `serialize` stays `JSON.stringify` (round ships inside the state).

- [ ] **Step 4: Run** `npm run test:unit` → PASS (also pre-existing tests updated where they assert English error strings)

- [ ] **Step 5: Commit** `feat: question round state machine with undo and Spanish copies in lib`

### Task 2: Flat dark theme in `styles.css` (all views)

**Files:**
- Modify: `src/styles.css` (rewrite of theme tokens, keep the `@import "tailwindcss";` line first)
- Test: `tests/e2e.spec.js` (replace the stripes test)

**Interfaces:**
- Consumes: nothing.
- Produces: the class names `app.js`/`index.html` already use keep working (`.card`, `.score`, `.points-row`, `.topbar`, `.podium`, `.overlay`, …). New tokens referenced by Task 3: `.q-strip` namespace is NOT styled here (Task 3 adds it).

Visual rules (from the spec):
- Theme tokens: `--color-ink: #0a0a0f; --color-surface: #121218; --color-surface-2: #15151d; --color-line: #2c2c3a; --color-text: #ffffff; --color-text-dim: #cfd2dc; --color-accent: #22d3ee; --color-danger: #ff5c7c;` plus the two ink-on-color pairs for `danger`/`primary` buttons.
- Body: flat `#0a0a0f`, **no** background-image gradients; delete the `body::before` stripe layer entirely.
- Remove every `text-shadow`, colored glow `box-shadow` and gradient from buttons, titles, scores, podium, overlay, toast. `.primary` button becomes solid white background with black text; `.danger` keeps red with dark ink text; `.ghost` flat with `--color-line` border.
- `.card` loses the 10px chip column: `grid-template-columns: 1fr`, no per-card colored glow; team identity moves to a thick top border — Task 3 sets `border-top: 10px solid <teamColor>` inline on `.card` (keep a default `border: 1px solid var(--color-line)` fallback in CSS).
- Typography up-scales for TV: group name `.card-head h3` ≈ 2rem, `.score` ≥ 3.4rem clamp, secondary/members ≈ 1.1rem, topbar title clamp(2.4rem, 5vw, 3.4rem); member list font 1.1rem with taller rows. Keep `tabular-nums` on scores and the fixed-layer/no-repaint care the file documents.
- Winner overlay/podium and toast: re-skinned to the same flat tokens (translucency and scroll behavior of the overlay already covered by tests — keep those properties).
- `prefers-reduced-motion` block stays.

- [ ] **Step 1: Replace the "decorative stripes live in a non-scrolling layer" test in `tests/e2e.spec.js`** with:

```js
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
```

- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e.spec.js` → the new test FAILS, others unchanged
- [ ] **Step 3: Rewrite** `src/styles.css` to the rules above (delete stripe layer, gradient uses, shadows; up-size type; update button styles; adapt `.card` to `1fr` grid)
- [ ] **Step 4: Run** `npm run test:e2e` → PASS (including the winner-overlay translucency/scroll and fade-in tests). Fix contrast values if the overlay test's alpha expectations shift.
- [ ] **Step 5: Commit** `feat: flat dark TV scoreboard theme across all views`

### Task 3: Question strip, timer, award UX (DOM)

**Files:**
- Modify: `index.html` (strip markup inside `#view-play`, sound toggle placeholder button in topbar controls)
- Modify: `src/app.js` (strip rendering, tick loop, award wiring, flash/confetti, crown, undo)
- Modify: `src/styles.css` (strip + flash styles, appended section)
- Test: `tests/e2e.board.spec.js`

**Interfaces:**
- Consumes: Task 1 exports (`initialRound/startRound/expireRound/awardPoints/undoLastAward/nextQuestion` accessed through the existing `api` facade).
- Produces: static markup ids used by its own tests — strip `#q-strip` with three sub-views: draft `#q-draft` (`#q-input` text, `#q-seconds` number, submit `#launch-question`), live `#q-live` (`#q-text`, `#q-timer`, bar `#q-bar`), after `#q-after` (`#q-result`, `#undo-award`, `#next-question`), plus topbar `#sound-toggle` (the 🔇/🔊 glyph switch is Task 4's sound; here it wires to persistence only).

Static markup to add in `index.html` (between topbar and `<main id="board">`):

```html
<section id="q-strip" class="q-strip" hidden>
  <form id="q-draft" hidden>
    <input id="q-input" type="text" maxlength="200" placeholder="Escribe la pregunta">
    <input id="q-seconds" type="number" min="5" max="300" step="5" value="30">
    <button type="submit" id="launch-question" class="primary">Mostrar y arrancar</button>
  </form>
  <div id="q-live" hidden>
    <h2 id="q-text"></h2>
    <span class="q-count"><span id="q-timer">30</span><span class="q-bar"><span id="q-bar"></span></span></span>
  </div>
  <div id="q-after" hidden>
    <h2 id="q-result"></h2>
    <div class="q-actions">
      <button type="button" id="undo-award">↩ deshacer punto</button>
      <button type="button" id="next-question" class="primary">Siguiente pregunta</button>
    </div>
  </div>
</section>
```

Behavior (all in `app.js`):
- **Visibility:** strip visible only when `state.phase === "playing"`; hidden otherwise (frozen/setup). Sub-view chosen by `round.phase`: `draft→#q-draft`, `live→#q-live`, `answered|expired→#q-after`; `#q-result` text: `"¡Punto para {nombre}!"` (accent color) on answered, `"⏱ ¡Tiempo!"` (danger color) on expired; multiple awards update the text to the most recent award.
- **Launch:** submit reads `#q-input` (trimmed; empty → toast `"Pregunta vacía"`), `api.setRoundQuestionValue` not needed — store text directly via a `setQuestion(state, text)` action (purpose: persist the draft text into `round.question`), then `api.startRound(state)`, persist, start ticking (Task 1 exports `startRound`; if the runner prefers, expose `setQuestion(state, text)` in Task 1's lib — settle it while implementing Task 1 and keep the name consistent).
- **Ticking:** `setInterval(200ms)` while live; `remaining = round.seconds*1000 - (Date.now()-roundStartAt)`; render `#q-timer` and bar width; on `remaining <= 0` → clear interval, `api.expireRound(state)`, persist, Task 4's sound hook (`sound.timeUp()`). `roundStartAt` is a module variable set at launch — never persisted (refresh restarts the countdown in full per spec).
- **Award:** card buttons switch from `data-action="points"`/`data-delta` to a single `+1` button `data-action="award"` (minus markup removed). Click → `api.awardPoints(state, groupId, 1)`, persist, `renderBoard()`, update strip, flash: add class `flash` to the awarded card and class `celebrating` to `#board` for 900 ms then remove (confetti = 8 absolutely-positioned colored squares injected in the card, removed with the flash; `prefers-reduced-motion` shortens both to ~0 i.e. classes removed synchronously).
- **Leader crown:** in `patchCardPlay`, if the group is the strict leader (`winners(state)` length 1 and its points > 0) render `👑` in the card head; otherwise remove it.
- **Undo:** `#undo-award` disabled when `round.undoLog` empty; click → `api.undoLastAward(state)`, persist, re-render board + strip (if the undone award was the message source, result text returns to `"⏱ ¡Tiempo!"` on expired rounds or the previous award text on answered rounds).
- **Next question:** click → `api.nextQuestion(state)`, persist, strip back to draft with `#q-seconds` pre-filled with the kept seconds.
- **Card template:** plus-button is the only button in `.points-row`; `setCardDisabled` behavior unchanged (frozen phase).

- [ ] **Step 1: Write failing e2e tests in `tests/e2e.board.spec.js`**

New tests (playwright `test.describe` in the same file, Spanish copy):
1. *"la pregunta aparece con cuenta atrás y se para al puntuar"* — setup contest, type question in `#q-input`, set `#q-seconds` to `5`, submit; `#q-live` visible with the question text and `#q-timer` counting down; click the first card's award button; expect `#q-after` visible with text matching `/¡Punto para /` and `#q-timer` gone (stopped); no further countdown after 2 s wait (parse `#q-*` nothing).
2. *"varios puntos en la misma pregunta repiten celebración y actualizan el mensaje"* — question launched (seconds 5), award group 1, then award group 2; expect result text naming the second group's name and both scores increment.
3. *"deshacer revierte el ultimo punto"* — after test 1's award, click `#undo-award`; score back to previous value; result text unchanged source; `#undo-award` disabled when nothing left.
4. *"la pregunta sobrevive a un refresco y el tiempo reinicia"* — launch (seconds 30), wait 1 s, `page.reload()`; Continue → `#view-play` shows `#q-live` with the same question text and `#q-timer` back at ~30.
5. *"sesion antigua sin ronda sigue cargando"* — `addInitScript` seeds a legacy state **without** `round` key (playing, 2 groups); Continue → play view renders with strip in draft.
6. **Update** the existing `"awards points with quick buttons in play; refresh keeps score"` test: remove the `−1` click (button is gone now; assert `[data-delta="-1"]` count is 0), award via `data-action="award"`.

- [ ] **Step 2: Run** `npm run test:e2e` → new tests FAIL (strip ids absent)
- [ ] **Step 3: Implement** — `index.html` markup per the static block; `app.js` behavior per the behavior list; strip/flash CSS appended (compact: `.q-strip` flat dark band, border `2px solid var(--color-line)`, `.q-strip[data-e="right"]`-style accent per phase: live `--color-line`, answered `#19a24b`-ish green border, expired `--color-danger`; undo chip small gray pill `border:1px solid var(--color-line); color:var(--color-text-dim); font-size:0.7rem; border-radius:999px;` not styled as a game button).
- [ ] **Step 4: Run** `npm run test:e2e` → PASS; run `npm run test:unit` → PASS (`app.test.js` may need the minus-button expectations removed)
- [ ] **Step 5: Commit** `feat: ad-hoc question strip with countdown, award flash and undo`

### Task 4: Web Audio sound + toggle

**Files:**
- Create: `src/sound.js`
- Modify: `src/app.js` (import + hooks at expiry and toggle rendering), `index.html` (toggle label glyphs)
- Test: none (jsdom has no reliable AudioContext; e2e only asserts persistence)

**Interfaces:**
- Consumes: nothing.
- Produces: `sound.enabled()` → boolean (reads `localStorage["contestBoard:sound"]`, `"on"` default); `sound.setEnabled(on)` (writes the key); `sound.timeUp()` — guarded oscillator beep (two-tone, ~0.4 s) wrapped in `try { new (window.AudioContext || window.webkitAudioContext)() } catch { }`; every method safe when storage or AudioContext are unavailable.

- [ ] **Step 1: Implement** `src/sound.js` per the interface. Two short oscillator notes (e.g. 880→660 Hz sine, 0.35 s total, gain envelope down) for expiry; a brighter two-note blip (660→990 Hz) available as `sound.award()` for Task 3's flash (optional — call it from the award handler behind `sound.enabled()`), both fully guarded.
- [ ] **Step 2: Wire** `#sound-toggle` in the topbar: label `🔊"/"🔇` reflects state; click → `sound.setEnabled(!enabled)`, update glyph, persist.
- [ ] **Step 3: e2e test** in `tests/e2e.board.spec.js`: toggle → reload → glyph/state persists (`data-sound="on|off"` attribute on the button for assertion).
- [ ] **Step 4: Run** `npm run test:e2e` → PASS
- [ ] **Step 5: Commit** `feat: web-audio expiry chime with persisted toggle`

### Task 5: Spanish copy sweep (all remaining UI strings)

**Files:**
- Modify: `index.html` («lang="es"», home/setup/play/overlay text)
- Modify: `src/app.js` (status line, history, toasts, confirm dialog, winner texts)
- Test: `tests/e2e.spec.js`, `tests/e2e.board.spec.js`, `src/app.test.js` (update assertions on strings)

**Interfaces:**
- Consumes: Task 1's Spanish colors/errors; does not add functions.
- Produces: final copy dictionary (exact strings):
  - `lang="es"`; title tag `Tablero de Concurso`.
  - Home: kicker `Concurso en directo para el aula`; title `Tablero de Concurso`; sub `Marcador preparado para proyectar. Todo se guarda en este navegador.`; buttons `Continuar la última sesión` / `Nueva partida`.
  - History heading `Partidas anteriores`; entries `Ganador: {names}`.
  - Setup: status `Elige grupos, ponles nombre y añade jugadores`; labels `Grupos` / `Añadir jugador`; buttons `Añadir`, `Empezar concurso`, `Inicio`; empty hint `Aún sin jugadores`; `Contest Board` brand → `Tablero de Concurso`.
  - Play status: `En directo` / `{n} grupo(s) · {m} jugador(es)` / `Concurso terminado`; button `Terminar concurso`.
  - Podium: `Ganador`; runner-up `Segundo puesto: {names}`; reset button `Archivar y volver al inicio`; confirm dialog `¿Archivar esta partida y empezar un concurso nuevo?`.
  - Toasts: `Nada guardado para continuar`, `No se pudo cargar la sesión guardada`, `Escribe un nombre para el jugador`, `Crea primero los grupos`, `No hay nada que deshacer` (from lib), plus handler-crash prefix `{label}: {message}` with Spanish labels (`Grupos`, `Añadir jugador`, `Empezar concurso`, `Inicio`).

- [ ] **Step 1: Update the string assertions first** (grep the three test files for English copy: `"Winner"`, `"Continue"`, `"Fresh"`, `"Add"`, `"Live"`, labels) and set the Spanish expectations from the dictionary above.
- [ ] **Step 2: Run** `npm run test:e2e -- tests/e2e.spec.js tests/e2e.board.spec.js` → FAIL on UI copy
- [ ] **Step 3: Apply the dictionary** in `index.html` + `app.js` (keep `#view-home` ids and structure; runner-up text and history names unchanged in data shape)
- [ ] **Step 4: Run** `npm run test:unit` and `npm run test:e2e` → ALL PASS
- [ ] **Step 5: Commit** `feat: interface fully in Spanish`

### Task 6: README + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README** (Spanish): describe the TV-use (project with high contrast), the question flow (write → launch → answer → award/undo → next), sound toggle, `npm run test:unit` / `npm run test:e2e` commands, GitHub Pages steps (unchanged).
- [ ] **Step 2: Run the whole suite:** `npm run test:unit` and `npm run test:e2e` → ALL PASS
- [ ] **Step 3: Build check:** `npm run build` → no errors; `npm run preview` and manual sanity check of home → setup → play → award → undo → next question → end contest.
- [ ] **Step 4: Commit** `docs: spanish readme for the TV contest board`

---

## Self-review notes

- Spec coverage: visual direction (Task 2), round machine (Task 1), strip/timer/award/undo/crown/flash (Task 3), sound (Task 4), Spanish sweep (Tasks 1+5), persistence/migration (Tasks 1+3), reduced motion (Tasks 2+3). Unchanged subsystems confirmed untouched except fonts of setup (Task 2 type up-scaling).
- Type consistency checked: `awardPoints/undoLastAward/nextQuestion/startRound/expireRound` names identical across Tasks 1/3/4.
- Review Focus inputs each pinned by a test in the owning task (listed inline).
