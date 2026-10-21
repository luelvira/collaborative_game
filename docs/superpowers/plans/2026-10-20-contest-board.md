# Contest Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-page, zero-dependency contest board: groups with chromatic-wheel colors, anti-starving random user assignment, ± points, end-contest winner display, persisted in `localStorage` with an archive of past plays, hosted on GitHub Pages from `main`.

**Architecture:** Plain ES-module JavaScript. Pure logic (colors, assignment, state transitions, persistence) lives in `lib.js`; DOM/UI lives in `app.js`. `lib.js` is tested with Node's built-in test runner (`node --test`) — no packages, no build step.

**Tech Stack:** HTML/CSS/vanilla JS (ES modules), `node:test` for unit tests.

**Spec:** Chat-approved design (brainstorming playback, approved by user 2026-10-20) + user amendment: persist multiple plays — each finished run is stored with its start timestamp.

## Global Constraints

- No external libraries or frameworks; no network dependencies (works offline, no CDN).
- Colors are pure HSL: `hsl(hue, 70%, 55%)` — constant S/L; hue = `(start + index * 360 / N) % 360`.
- Max 6 groups.
- Assignment: random among groups with the fewest members.
- State auto-saves to `localStorage` on every mutation; refresh never loses the contest.
- **Multi-run persistence:** current run state under key `contestBoard:current` (includes `startedAt: Date.now()`); every finalized run archived under `contestBoard:history` as `{ startedAt, endedAt, groups, winners }`; a "past plays" section lists archived runs by start timestamp + winner.
- Frozen phase: no edits except "Reset".

## Review Focus

1. Refresh mid-contest → board restored exactly (same groups, members, points, phase).
2. Tie at contest end → all tied groups shown as joint winners.
3. Removing a non-empty group → blocked with feedback.
4. "Add user" with zero groups or empty name → no-op with feedback, no corrupt state.
5. Custom points field with junk input (`""`, `abc`) → ignored; integers/floats accepted, including negatives.

---

### Task 1: Pure logic module with tests

**Files:**
- Create: `lib.js`
- Create: `lib.test.js`

**Interfaces (Produces — later tasks rely on these exactly):**

- `colorHue(startHue: number, count: number, index: number): number` — `(startHue + index * 360 / count) % 360`
- `colorFor(startHue: number, groups: Group[], id: string): string` — returns `hsl(h, 70%, 55%)`
- `pickGroup(rng: () => number, memberCounts: number[]): number` — index of a random minimum-size group
- `newState(rng = Math.random): State` — `{ startedAt: Date.now(), phase: "setup", startHue: rng()*360, groups: [] }`
- `addGroup(state, name: string): { ok: true } | { error: string }` — max 6 groups
- `removeGroup(state, id: string): { ok | error }` — error if group has members (Review Focus 3)
- `addMember(state, id: string, name: string): { ok | error }` — errors: no such group / empty name; assigns via pickGroup on *current* member counts (Review Focus 4: unknown group id rejected)
- `removeMember(state, id: string, name: string): { ok | error }`
- `addPoints(state, id: string, amount: number): { ok | error }`
- `winners(state): string[]` — array of group ids with max points (ties included)
- `archiveRun(state, endedAt = Date.now()): RunRecord` — `{ startedAt, endedAt, groups, winners }`
- `serialize(state): string` / `deserialize(json: string): State` — round-trips `startedAt`, `phase`, groups
- `loadHistory(storageLike): RunRecord[]` / `saveHistory(storageLike, runs)` — storage shape `{ getItem, setItem }` so `localStorage` and tests share code

Group shape: `{ id, name, members: string[], points: number }`. State shape: `{ startedAt, phase: "setup"|"frozen", startHue, groups }`.

- [ ] **Step 1: Write the failing tests** — hue split math (`colorHue(10, 4, 0|1|2|3) === [10, 100, 190, 280]`; wrap: `colorHue(350, 4, 2) === 130`), color string format, `pickGroup` with seeded rng picks among min groups only, validators reject bad input (max 6 groups, non-empty removal, empty member name, junk points), `winners` tie set, serialize round-trip preserves `startedAt` + `phase`, `archiveRun` record shape, history save/load round-trip.
- [ ] **Step 2: Run** `node --test` → FAIL (module missing)
- [ ] **Step 3: Implement `lib.js`** (CommonJS-compatible export guard for Node: `export` with a `module.exports` fallback)
- [ ] **Step 4: Run** `node --test` → PASS
- [ ] **Step 5: Commit** `feat: contest state, color and persistence logic`

### Task 2: Static shell + styles

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `.nojekyll`

- [ ] HTML: top bar ("Add group" button+name field, "Add user" input+button, "End contest" button), `#board` grid, hidden `#winner` overlay (podium of tied groups listing member names + "Reset" button), `#history` section, `<script type="module" src="app.js">`
- [ ] CSS: dark modern theme, card grid `repeat(auto-fit, minmax(240px, 1fr))`, color chip band per card, big ±buttons
- [ ] Open in browser → shell renders without JS errors
- [ ] Commit `feat: page shell and styles`

### Task 3: Setup-phase UI

**Files:**
- Modify: `app.js`

**Consumes:** all Task 1 interfaces (`newState`, `addGroup`, `removeGroup`, `addMember`, `removeMember`, `addPoints`, `colorFor`, `serialize`, `deserialize`, `loadHistory`, `saveHistory`, `archiveRun`).

- [ ] Render-from-state: on load, `deserialize(localStorage.getItem("contestBoard:current"))` or `newState()`
- [ ] Wire all actions; every mutation → `serialize` → `localStorage.setItem`
- [ ] "Past plays" section from `loadHistory(localStorage)`; render after each reset
- [ ] Manual check after adding 3 groups / 7 users: balance holds; hues evenly spaced
- [ ] Commit `feat: interactive board`

### Task 4: End contest / winner / reset

**Files:**
- Modify: `app.js`
- Modify: `lib.test.js` (empty-board `winners` edge if needed)

- [ ] "End contest" → `phase: "frozen"`, persist, overlay lists winner(s) + members; board read-only
- [ ] "Reset" → confirm dialog → `archiveRun` into history (`saveHistory`), `newState()` → persist → setup phase, history re-rendered
- [ ] Refresh during frozen phase → still frozen
- [ ] Commit `feat: winner display, reset and play archive`

### Task 5: GitHub Pages readiness

**Files:**
- Modify: `README.md`

- [ ] README: what the app does, `node --test` to run tests, Pages enable steps (Settings → Pages → Deploy from branch → `main` / root), `.nojekyll` rationale
- [ ] Commit `docs: GitHub Pages deployment instructions`

---

- **Execution method (chosen by user): Native** — inline execution in this session, one fresh reviewer at the end.
