"use strict";

import * as lib from "./lib.js";
import { sound } from "./sound.js";

// Mutable façade so tests can sabotage a single action without rewriting ESM bindings.
export const api = { ...lib };

const CURRENT_KEY = "contestBoard:current";
const $ = (sel) => document.querySelector(sel);
const els = {};

// Task 4 seam (filled): the sound module guards internally (enabled check +
// try/catch), so these callers stay unconditional one-liners. Expiry plays
// the 3-second falling closure chime; an award plays the short festive
// fanfare; freezing the contest plays the long first-place victory tune.
function notifyExpiry() {
  sound.timeUp();
}
function notifyAward() {
  sound.award();
}
function notifyVictory() {
  sound.victory();
}

// Question strip timing — never persisted: a refresh restarts the countdown
// in full (spec decision), and expiry must not re-fire after a reload.
let roundStartAt = 0;
let tickTimer = null;
// Audio cue memory for the countdown (also never persisted): the halfway beep
// fires once per round, and the heartbeat fires once per remaining second.
let cueState = { halfFired: false, lastBeatSec: null };
// The expired-round memory itself IS persisted: round.expired (lib.js) so it
// survives a refresh — the strip keeps "⏱ ¡Tiempo!" as its source message
// after every award has been undone.

let state;

function persist() {
  if (state) {
    localStorage.setItem(CURRENT_KEY, api.serialize(state));
  }
}

function clampSeconds(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 30;
  return Math.min(300, Math.max(5, n || 30));
}

function stopRoundTick() {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function startRoundTick() {
  stopRoundTick();
  roundStartAt = Date.now();
  cueState = { halfFired: false, lastBeatSec: null };
  tickTimer = setInterval(onRoundTick, 200);
}

// Pure seam for the audio cues. At each tick the countdown decides between:
// — the halfway tension beep ("tempo bajo"), fired exactly once when the
//   remaining time first drops to 50 % of the total (inclusive edge);
// — the danger heartbeat, one beat per remaining second in the last 5 s
//   (same tension alarm family), intensifying as it goes: the caller maps
//   sec → level = 5 − sec, so 5 s is the softest beat and 1 s the strongest.
export function countdownCues(remaining, total, s = {}) {
  const cue = { halfTime: false, heartbeat: null };
  if (total <= 0 || remaining <= 0) return cue;
  if (!s.halfFired && remaining <= total / 2) cue.halfTime = true;
  const sec = Math.ceil(remaining / 1000);
  if (sec <= 5 && sec !== s.lastBeatSec) cue.heartbeat = sec;
  return cue;
}

function applyCues(remaining, total) {
  const cue = countdownCues(remaining, total, cueState);
  if (cue.halfTime) cueState.halfFired = true;
  if (cue.heartbeat !== null) cueState.lastBeatSec = cue.heartbeat;
  if (cue.halfTime) sound.halfTime();
  if (cue.heartbeat !== null) sound.heartbeat(5 - cue.heartbeat);
}

function onRoundTick() {
  if (!state || state.phase !== "playing" || state.round?.phase !== "live") {
    stopRoundTick();
    return;
  }
  const total = clampSeconds(state.round.seconds) * 1000;
  const remaining = total - (Date.now() - roundStartAt);
  if (remaining <= 0) {
    stopRoundTick();
    const res = api.expireRound(state);
    if (res && res.error) return;
    persist();
    renderStrip();
    notifyExpiry();
    return;
  }
  paintQTimer(remaining, total);
  applyCues(remaining, total);
}

// Pure seam for the countdown tones: "flat" keeps the plain white pill/fill,
// "warn" (≤ 50 % of the total) goes orange and "danger" (≤ 5000 ms) goes red.
// The ≤ 5 s rule is checked FIRST so a 5 s question starts directly in danger
// and a value that satisfies both thresholds keeps the red tone.
export function countdownTone(remainingMs, totalMs) {
  if (remainingMs <= 5000) return "danger";
  if (remainingMs <= totalMs / 2) return "warn";
  return "flat";
}

// Class map for a tone, applied idempotently: compute the wanted set and
// toggle each of the three classes to present/absent, so either tone change
// sweeps stale classes and repeated 200 ms ticks restart nothing. Colors
// live in CSS (`q-warn` orange, `q-danger` red); `q-pulse` is the danger-only
// 1 s zoom breathing. The pulse goes on both offered elements (#q-timer and
// the bar container .q-bar) — transforms never trigger layout shifts, so the
// strip's neighbours cannot jump.
function applyQTimerTone(tone) {
  const timer = $("#q-timer");
  const fill = $("#q-bar");
  const barWrap = fill ? fill.parentElement : null;
  const wants = tone === "warn" ? ["q-warn"] : tone === "danger" ? ["q-danger", "q-pulse"] : [];
  const paint = (el) => {
    if (!el) return;
    for (const cls of ["q-warn", "q-danger", "q-pulse"]) {
      el.classList.toggle(cls, wants.includes(cls));
    }
  };
  paint(timer);
  paint(fill);
  paint(barWrap);
}

function paintQTimer(remaining, total) {
  const timer = $("#q-timer");
  const bar = $("#q-bar");
  if (timer) timer.textContent = String(Math.ceil(remaining / 1000));
  if (bar) bar.style.width = `${Math.max(0, Math.min(1, remaining / total)) * 100}%`;
  applyQTimerTone(countdownTone(remaining, total));
}

// Message of the after-view: the most recent award of the CURRENT question
// wins; anything older (the log survives nextQuestion so those awards stay
// undoable) must not mask this round's own story — an empty current window
// returns the round to its source message (the time out, or nothing at all
// when the point came before any question was launched).
function afterMessage() {
  const round = state.round;
  const mine = round.undoLog.slice(round.logStart ?? 0);
  const last = mine[mine.length - 1];
  if (last) {
    const name = api.groupName(state.startHue, state.groups, last.groupId);
    return { text: `¡Punto para ${name}!`, kind: "award" };
  }
  if (round.phase === "expired" || round.expired === true) {
    return { text: "⏱ ¡Tiempo!", kind: "expired" };
  }
  return { text: "", kind: "none" };
}

// Single source of truth for the strip: visibility follows the contest phase,
// the sub-view follows the round phase. Safe to call on every board refresh.
function renderStrip() {
  const strip = $("#q-strip");
  if (!strip) return;
  if (state.phase !== "playing") {
    stopRoundTick();
    strip.hidden = true;
    return;
  }
  const round = state.round ?? (state.round = api.initialRound());
  strip.hidden = false;
  let sub = "after";
  if (round.phase === "draft" || round.phase === "live") sub = round.phase;
  strip.dataset.e = round.phase;
  for (const id of ["q-draft", "q-live", "q-after"]) {
    const subView = $(`#${id}`);
    if (subView) subView.hidden = id !== `q-${sub}`;
  }
  if (sub === "draft") {
    stopRoundTick();
    const secs = $("#q-seconds");
    // Prefill from the round; never clobber text the teacher is already typing.
    if (secs && secs.value !== String(clampSeconds(round.seconds))) {
      secs.value = String(clampSeconds(round.seconds));
    }
    return;
  }
  if (sub === "live") {
    if (tickTimer === null) startRoundTick();
    const qText = $("#q-text");
    if (qText && qText.textContent !== round.question) {
      qText.textContent = round.question;
    }
    const total = clampSeconds(round.seconds) * 1000;
    paintQTimer(Math.max(0, total - (Date.now() - roundStartAt)), total);
    return;
  }
  stopRoundTick();
  const msg = afterMessage();
  // The accent follows the message source: an expired round whose awards were
  // all undone keeps the red "⏱ ¡Tiempo!" accent even though its phase is
  // answered — the persisted round.expired flag is the real source of truth.
  if (msg.kind === "award") strip.dataset.e = "answered";
  if (msg.kind === "expired") strip.dataset.e = "expired";
  const result = $("#q-result");
  if (result) {
    result.textContent = msg.text;
    result.classList.toggle("q-ok", msg.kind === "award");
    result.classList.toggle("q-bad", msg.kind === "expired");
  }
  const undo = $("#undo-award");
  if (undo) undo.disabled = round.undoLog.length === 0;
}

// The awarded card fills flat with its team color, the rest of the board dims
// for the same 900 ms, and 8 colored squares drop inside the card. Color-on /
// color-off only (no gradients, no shadows); under prefers-reduced-motion the
// classes are removed synchronously so nothing animates. Exported for the
// guard unit tests (final-review Finding 3).
export function celebrate(card) {
  const board = $("#board");
  if (!card || !board) return;
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.classList.add("flash");
  board.classList.add("celebrating");
  const confetti = [];
  if (!reduced) {
    const team = api.colorFor(state.startHue, state.groups, card.dataset.groupId);
    const colors = [team, "var(--color-accent)", "var(--color-text)", "var(--color-success)"];
    for (let i = 0; i < 8; i++) {
      const square = document.createElement("span");
      square.className = "confetti";
      square.style.left = `${8 + i * 11 + Math.round(Math.random() * 5)}%`;
      square.style.top = `${Math.round(Math.random() * 26)}%`;
      square.style.background = colors[i % colors.length];
      square.style.animationDelay = `${(i % 4) * 70}ms`;
      card.append(square);
      confetti.push(square);
    }
  }
  const clean = () => {
    card.classList.remove("flash");
    board.classList.remove("celebrating");
    confetti.forEach((square) => square.remove());
  };
  if (reduced) clean();
  else setTimeout(clean, 900);
}

// Sound toggle: owner of the state contract — key `contestBoard:sound`
// ("on"/"off", default on) inside sound.js, plus the `data-sound` attribute
// and glyph on the button rendered here.
function updateSoundToggle() {
  const btn = $("#sound-toggle");
  if (!btn) return;
  const on = sound.enabled();
  btn.textContent = on ? "🔊" : "🔇";
  btn.setAttribute("data-sound", on ? "on" : "off");
  btn.setAttribute("aria-label", on ? "Sonido activado" : "Sonido desactivado");
}

function wireSound() {
  const btn = $("#sound-toggle");
  if (!btn) return;
  updateSoundToggle();
  btn.addEventListener("click", () => {
    sound.setEnabled(!sound.enabled());
    updateSoundToggle();
  });
}

function wireStrip() {
  const form = $("#q-draft");
  if (form) {
    form.addEventListener(
      "submit",
      on((event) => {
        event.preventDefault();
        if (state.phase !== "playing") return;
        const input = $("#q-input");
        const text = (input?.value ?? "").trim();
        if (!text) return toast("Pregunta vacía");
        const seconds = clampSeconds($("#q-seconds")?.value);
        const round = state.round ?? (state.round = api.initialRound(seconds));
        // lib has no action for the countdown length; clamp it here so a
        // hand-typed value can never send the timer outside 5..300.
        round.seconds = seconds;
        const q = api.setQuestion(state, text);
        if (q && q.error) return toast(q.error);
        const r = api.startRound(state);
        if (r && r.error) return toast(r.error);
        persist();
        input.value = "";
        renderStrip();
      }, "Pregunta"),
    );
  }
  const undo = $("#undo-award");
  if (undo) {
    undo.addEventListener(
      "click",
      on(() => {
        const res = api.undoLastAward(state);
        if (res && res.error) return toast(res.error);
        persist();
        renderBoard();
      }, "Deshacer"),
    );
  }
  const next = $("#next-question");
  if (next) {
    next.addEventListener(
      "click",
      on(() => {
        const res = api.nextQuestion(state);
        if (res && res.error) return toast(res.error);
        persist();
        const input = $("#q-input");
        if (input) input.value = "";
        renderBoard();
        // The next question is typed right away; put the cursor there.
        input?.focus();
      }, "Siguiente"),
    );
  }
}

let toastTimer;
function toast(message) {
  let node = $("#toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "toast";
    // Screen readers announce the transient message like a status update.
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}

function showView(view) {
  ["#view-home", "#view-setup", "#view-play"].forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    if (sel === view) {
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  });
}

function updateHome() {
  const hasSaved = api.hasSavedSession(localStorage);
  const continueBtn = $("#continue-session");
  if (continueBtn) {
    continueBtn.disabled = !hasSaved;
  }
}

function renderHistory() {
  const runs = api.loadHistory(localStorage);
  const historyEl = $("#history");
  if (!historyEl) return;
  if (runs.length === 0) {
    historyEl.hidden = true;
    return;
  }
  historyEl.hidden = false;
  const list = document.createElement("ul");
  runs
    .slice()
    .reverse()
    .forEach((run) => {
      const li = document.createElement("li");
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = new Date(run.startedAt).toLocaleString();
      const names = (run.winners || [])
        .map((id) => run.groups.find((g) => g.id === id)?.name)
        .filter(Boolean)
        .join(" & ");
      const who = document.createElement("span");
      who.textContent = names ? `Ganador: ${names}` : "Ganador: -";
      li.append(when, who);
      list.append(li);
    });
  historyEl.replaceChildren(document.createElement("h2"), list);
  const h2 = historyEl.querySelector("h2");
  if (h2) h2.textContent = "Partidas anteriores";
}

function renderSetup() {
  const groupCountInput = $("#group-count");
  const setupGroups = $("#setup-groups");
  if (!groupCountInput || !setupGroups) return;

  const n = state.groups.length || Number(groupCountInput.value) || 2;
  if (groupCountInput.value != n && n >= 2 && n <= 6) {
    groupCountInput.value = String(n);
  }

  setupGroups.innerHTML = "";

  // No groups chosen yet — nothing renders until N is picked.
  if (n === 0 || state.startHue == null) {
    updateStartContestButton();
    return;
  }

  // Same balanced row layout as the board (≤ 3 editors per row), so the
  // setup screen mirrors what the projector will show during play.
  const sizes = api.rowSizes(state.groups.length);
  let idx = 0;
  sizes.forEach((size, r) => {
    const row = document.createElement("div");
    row.className = "board-row";
    row.dataset.row = String(r);
    for (let s = 0; s < size; s++, idx++) {
      row.append(setupGroupEditor(state.groups[idx]));
    }
    setupGroups.append(row);
  });

  updateStartContestButton();
}

function updateStartContestButton() {
  const btn = $("#start-contest");
  if (!btn) return;
  const members = state.groups.reduce((sum, g) => sum + g.members.length, 0);
  if (state.groups.length >= 2 && members >= 1) {
    btn.disabled = false;
  } else {
    btn.disabled = true;
  }
}

// One editable group card for the setup screen: color swatch, rename input
// and the setup-only member list with remove buttons.
function setupGroupEditor(group) {
  const groupEl = document.createElement("section");
  groupEl.className = "setup-group";
  groupEl.dataset.groupId = group.id;

  const header = document.createElement("header");
  header.className = "setup-group-header";
  const swatch = document.createElement("span");
  swatch.className = "setup-swatch";
  swatch.style.background = api.colorFor(state.startHue, state.groups, group.id);
  const nameInput = document.createElement("input");
  nameInput.className = "setup-group-name";
  nameInput.type = "text";
  nameInput.value = group.name || api.groupName(state.startHue, state.groups, group.id);
  nameInput.maxLength = 30;
  nameInput.addEventListener("change", () => {
    const res = api.renameGroup(state, group.id, nameInput.value);
    if (res && res.error) {
      toast(res.error);
      nameInput.value = group.name || api.groupName(state.startHue, state.groups, group.id);
      return;
    }
    persist();
    renderSetup();
    renderBoard();
  });
  header.append(swatch, nameInput);
  groupEl.append(header);

  const membersWrap = document.createElement("div");
  membersWrap.className = "setup-members";
  const list = document.createElement("ul");
  list.className = "setup-members-list";
  if (group.members.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-hint";
    empty.textContent = "Aún sin jugadores";
    list.append(empty);
  } else {
    group.members.forEach((m) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = m;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "rm";
      rm.textContent = "✕";
      // WAVE: the glyph alone carries no meaning — label it for the player.
      rm.setAttribute("aria-label", `Quitar a ${m}`);
      rm.title = `Quitar a ${m}`;
      rm.addEventListener("click", () => {
        const res = api.removeMember(state, group.id, m);
        if (res && res.error) {
          toast(res.error);
          return;
        }
        persist();
        renderSetup();
      });
      li.append(span, rm);
      list.append(li);
    });
  }
  membersWrap.append(list);
  groupEl.append(membersWrap);
  return groupEl;
}

function memberRowPlay(name) {
  const li = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = name;
  li.append(label);
  return li;
}

function cardTemplatePlay(group) {
  const card = document.createElement("article");
  card.className = "card card-enter";
  card.dataset.groupId = group.id;
  card.innerHTML = `
    <div class="card-body">
      <div class="card-head">
        <h2></h2>
        <span class="crown"></span>
      </div>
      <div class="score"></div>
      <div class="points-row">
        <button type="button" class="plus" data-action="award">+1</button>
      </div>
      <ul class="members"></ul>
      <span class="empty-hint" hidden>Aún sin jugadores</span>
    </div>`;
  patchCardPlay(card, group, { isNew: true });
  return card;
}

function patchCardPlay(card, group, { isNew = false } = {}) {
  const color = api.colorFor(state.startHue, state.groups, group.id);
  // Team identity as flat color: the thick top border is the label, and the
  // CSS var feeds the award flash (the card fills with the same color).
  if (card.style.getPropertyValue("--team-color") !== color) {
    card.style.setProperty("--team-color", color);
  }
  card.style.borderTop = `10px solid ${color}`;
  const h3 = card.querySelector(".card-head h2");
  if (h3) {
    h3.textContent = api.groupName(state.startHue, state.groups, group.id);
  }
  const crownEl = card.querySelector(".crown");
  if (crownEl) {
    // Decorative leader crown: strict leader with at least one point, and
    // purely decorative for assistive tech (the name + score already say it).
    const leaderIds = api.winners(state);
    const isLeader = leaderIds.length === 1 && leaderIds[0] === group.id && group.points > 0;
    const glyph = isLeader ? "👑" : "";
    if (crownEl.textContent !== glyph) {
      crownEl.textContent = glyph;
    }
    crownEl.setAttribute("aria-hidden", "true");
  }

  const scoreNode = card.querySelector(".score");
  if (scoreNode) {
    const nextScore = String(group.points);
    if (scoreNode.textContent !== nextScore) {
      scoreNode.textContent = nextScore;
    }
  }

  const membersNode = card.querySelector(".members");
  if (membersNode) {
    const shown = [...membersNode.querySelectorAll("li span")].map((n) => n.textContent);
    if (shown.length !== group.members.length || shown.some((n, i) => n !== group.members[i])) {
      membersNode.replaceChildren(...group.members.map(memberRowPlay));
    }
  }
  const hint = card.querySelector(".empty-hint");
  if (hint) hint.hidden = group.members.length > 0;
  setCardDisabled(card, state.phase === "frozen");
}

function setCardDisabled(card, disabled) {
  card.querySelectorAll("button").forEach((b) => (b.disabled = disabled));
  card.querySelectorAll("input").forEach((i) => (i.disabled = disabled));
}

// Create/remove .board-row containers so their count matches rowSizes(n);
// common case (score updates) touches nothing here.
function ensureRows(container, sizes) {
  let rows = [...container.querySelectorAll(".board-row")];
  while (rows.length < sizes.length) {
    const row = document.createElement("div");
    row.className = "board-row";
    container.appendChild(row);
    rows.push(row);
  }
  while (rows.length > sizes.length) {
    rows.pop().remove();
  }
  rows.forEach((row, i) => {
    if (row.dataset.row !== String(i)) row.dataset.row = String(i);
  });
  return rows;
}

// Keep existing card nodes; only create/remove/move when the group set or
// layout actually changes, so a score update never re-triggers the enter
// animation (no flash on every board refresh).
function renderBoard() {
  const board = $("#board");
  if (!board) return;

  const groups = state.groups || [];
  const sizes = api.rowSizes(groups.length);
  const rows = ensureRows(board, sizes);

  // Sweep away cards whose group no longer exists.
  const keep = new Set(groups.map((g) => g.id));
  for (const card of board.querySelectorAll(".card")) {
    if (!keep.has(card.dataset.groupId)) card.remove();
  }

  let idx = 0;
  rows.forEach((row, r) => {
    for (let slot = 0; slot < sizes[r]; slot++, idx++) {
      let card = board.querySelector(`.card[data-group-id="${groups[idx].id}"]`);
      if (!card) {
        card = cardTemplatePlay(groups[idx]);
      }
      // Re-parent or re-order in place only when the position actually differs;
      // insertBefore with the right neighbour keeps DOM churn at zero for the
      // common case (score updates), so nothing re-animates.
      if (card.parentElement !== row || row.children[slot] !== card) {
        row.insertBefore(card, row.children[slot] || null);
      }
      patchCardPlay(card, groups[idx]);
    }
  });

  updatePlayChrome();
  renderStrip();
}

function updatePlayChrome() {
  const status = $("#status-line");
  if (status) {
    const n = state.groups.length;
    const members = state.groups.reduce((sum, g) => sum + g.members.length, 0);
    if (state.phase === "frozen") {
      status.textContent = "Concurso terminado";
    } else if (state.phase === "playing") {
      // Spanish plural: 1 grupo / 1 jugador take no ending (same shape as the
      // old `${n === 1 ? "" : "s"}` trick, just written out per dictionary).
      status.textContent = `${n} ${n === 1 ? "grupo" : "grupos"} · ${members} ${members === 1 ? "jugador" : "jugadores"}`;
    } else {
      status.textContent = "En directo";
    }
  }
  const endBtn = $("#end-contest");
  if (endBtn) {
    endBtn.disabled = state.phase !== "playing" || state.groups.length === 0;
  }
}

// Podium step: one li per top-3 group with its place badge (1º/2º/3º), name
// and score — all information lives in text, no color-only encoding, and the
// team color is the flat block under text in the dark ink-on-color style.
function podiumStep(group, place) {
  const li = document.createElement("li");
  li.className = "step";
  li.dataset.place = String(place);
  li.style.setProperty("--team-color", api.colorFor(state.startHue, state.groups, group.id));
  const placeEl = document.createElement("span");
  placeEl.className = "step-place";
  placeEl.textContent = `${place}º`;
  const nameEl = document.createElement("span");
  nameEl.className = "step-name";
  nameEl.textContent = api.groupName(state.startHue, state.groups, group.id);
  const scoreEl = document.createElement("span");
  scoreEl.className = "step-score";
  scoreEl.textContent = String(group.points);
  li.append(placeEl, nameEl, scoreEl);
  return li;
}

function rankingRow(group, place) {
  const li = document.createElement("li");
  const rankEl = document.createElement("span");
  rankEl.className = "rank";
  rankEl.textContent = `${place}º`;
  const nameEl = document.createElement("span");
  nameEl.className = "rank-name";
  nameEl.textContent = api.groupName(state.startHue, state.groups, group.id);
  const scoreEl = document.createElement("span");
  scoreEl.className = "rank-score";
  // Spanish plural: "1 punto" / "0/2 puntos".
  scoreEl.textContent = `${group.points} ${group.points === 1 ? "punto" : "puntos"}`;
  li.append(rankEl, nameEl, scoreEl);
  return li;
}

// Final screen: a classic two-wing podium with the top-3 groups (place badge,
// name and score on every step) and the remaining teams ranked by score below
// — every group's score is visible somewhere on the screen (spec).
function renderWinner() {
  const winnerEl = $("#winner");
  const podiumEl = $("#podium-steps");
  const rankingEl = $("#ranking");
  if (!winnerEl) return;
  if (state.phase !== "frozen") {
    winnerEl.hidden = true;
    return;
  }
  // Stable sort keeps original group order inside a tie.
  const ranked = [...(state.groups || [])].sort((a, b) => b.points - a.points);
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(top.length);

  if (podiumEl) {
    podiumEl.replaceChildren();
    // Classic display: 2º hides behind the taller 1º on the left, 3º on the
    // right; with two groups it is "2º left, 1º right".
    const visual = top.length === 3 ? [top[1], top[0], top[2]] : top.slice().reverse();
    visual.forEach((group) => {
      podiumEl.append(podiumStep(group, ranked.indexOf(group) + 1));
    });
  }
  if (rankingEl) {
    rankingEl.replaceChildren(
      ...rest.map((group, i) => rankingRow(group, top.length + i + 1)),
    );
  }

  const winnerIds = api.winners(state);
  const winnerName = $("#winner-name");
  const winnerMembers = $("#winner-members");
  const names = winnerIds
    .map((id) => api.groupName(state.startHue, state.groups, id))
    .filter(Boolean);
  if (winnerName) winnerName.textContent = names.join(" & ") || "Empate";
  if (winnerMembers) {
    winnerMembers.replaceChildren();
    state.groups
      .filter((g) => winnerIds.includes(g.id))
      .forEach((g) => {
        (g.members || []).forEach((name) => {
          const li = document.createElement("li");
          li.textContent = name;
          winnerMembers.appendChild(li);
        });
      });
  }
  winnerEl.hidden = false;
}

function wireHome() {
  const cont = $("#continue-session");
  const fresh = $("#fresh-session");
  if (cont) {
    cont.addEventListener("click", () => {
      const raw = localStorage.getItem(CURRENT_KEY);
      if (!raw) {
        toast("Nada guardado para continuar");
        updateHome();
        return;
      }
      try {
        state = api.deserialize(raw);
        if (!state || !Array.isArray(state.groups)) throw new Error("bad");
      } catch (e) {
        toast("No se pudo cargar la sesión guardada");
        return;
      }
      persist();
      // Go to appropriate view based on phase
      if (state.phase === "playing") {
        showView("#view-play");
        renderBoard();
        renderWinner();
      } else if (state.phase === "frozen") {
        showView("#view-play");
        renderBoard();
        renderWinner();
      } else {
        showView("#view-setup");
        renderSetup();
      }
      renderHistory();
    });
  }
  if (fresh) {
    fresh.addEventListener("click", () => {
      state = api.newState();
      // A brand-new session only persists once the user edits something, so
      // "Continue last session" stays disabled for untouched fresh setups.
      showView("#view-setup");
      const gc = $("#group-count");
      if (gc) gc.value = String(state.groups.length);
      renderSetup();
      renderHistory();
    });
  }
}

// Wrap an event handler so an unexpected exception becomes a visible toast
// instead of a silently dead control.
function on(handler, label) {
  return (event) => {
    try {
      return handler(event);
    } catch (e) {
      return toast((label ? label + ": " : "") + (e && e.message ? e.message : e));
    }
  };
}

function wireSetup() {
  const gc = $("#group-count");
  if (gc) {
    gc.addEventListener(
      "change",
      on(() => {
        const n = Number(gc.value);
        const res = api.setGroupCount(state, n);
        if (res && res.error) {
          toast(res.error);
          gc.value = String(state.groups.length || 2);
          return;
        }
        persist();
        renderSetup();
      }, "Grupos"),
    );
  }
  const addUser = $("#add-user");
  const userName = $("#user-name");
  const addNamedUser = () => {
    if (!userName) return;
    const name = userName.value.trim();
    if (!name) return toast("Escribe un nombre para el jugador");
    if (!state.groups || state.groups.length === 0) return toast("Crea primero los grupos");
    const anchor = state.groups[0];
    const res = api.addMember(state, anchor.id, name);
    if (res && res.error) {
      toast(res.error);
      return;
    }
    userName.value = "";
    persist();
    renderSetup();
  };
  if (addUser) addUser.addEventListener("click", on(addNamedUser, "Añadir jugador"));
  if (userName) {
    userName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addNamedUser();
      }
    });
  }
  const start = $("#start-contest");
  if (start) {
    start.addEventListener(
      "click",
      on(() => {
        const res = api.startContest(state);
        if (res && res.error) {
          toast(res.error);
          return;
        }
        persist();
        showView("#view-play");
        renderBoard();
        renderWinner();
      }, "Empezar concurso"),
    );
  }
  const setupHome = $("#setup-home");
  if (setupHome) {
    setupHome.addEventListener(
      "click",
      on(() => {
        showView("#view-home");
        updateHome();
        renderHistory();
      }, "Inicio"),
    );
  }
}

function wirePlay() {
  const board = $("#board");
  if (board) {
    board.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || !board.contains(target)) return;
      const card = target.closest(".card");
      if (!card) return;
      const groupId = card.dataset.groupId;
      const action = target.dataset.action;
      if (action === "award") {
        // Awarding IS stopping: the countdown never comes back this round,
        // not even for the first award.
        stopRoundTick();
        const res = api.awardPoints(state, groupId, 1);
        if (res && res.error) {
          toast(res.error);
          return;
        }
        persist();
        renderBoard();
        celebrate(card);
        notifyAward();
        return;
      }
    });
  }
  const end = $("#end-contest");
  if (end) {
    end.addEventListener("click", () => {
      const res = api.endContest(state);
      if (res && res.error) {
        toast(res.error);
        return;
      }
      persist();
      renderBoard();
      renderWinner();
      // The victory screen deserves the full first-place fanfare; nothing
      // plays when the end call is refused (error path already returned).
      notifyVictory();
    });
  }
}

function wireOverlay() {
  const reset = $("#reset");
  if (reset) {
    reset.addEventListener("click", () => {
      if (!window.confirm("¿Archivar esta partida y empezar un concurso nuevo?")) return;
      const runs = api.loadHistory(localStorage);
      runs.push(api.archiveRun(state));
      api.saveHistory(localStorage, runs);
      state = api.newState();
      persist();
      const winnerEl = $("#winner");
      if (winnerEl) winnerEl.hidden = true;
      showView("#view-home");
      updateHome();
      renderHistory();
    });
  }
}

function boot() {
  [
    ["board", "#board"],
    ["endContest", "#end-contest"],
    ["history", "#history"],
    ["winner", "#winner"],
    ["winnerName", "#winner-name"],
    ["winnerMembers", "#winner-members"],
    ["podiumSteps", "#podium-steps"],
    ["ranking", "#ranking"],
    ["reset", "#reset"],
    ["status", "#status-line"],
  ].forEach(([key, sel]) => {
    const el = $(sel);
    if (el) els[key] = el;
  });

  // Always start at home
  showView("#view-home");
  updateHome();
  renderHistory();

  wireHome();
  wireSetup();
  wirePlay();
  wireOverlay();
  wireStrip();
  wireSound();

  // Expose for tests
  window.__contestApi = api;

  // Manual state patching from the dev console (README documents it): a
  // safety valve for the teacher — fix a typo or a member list mid-contest
  // without losing points. get returns the serialized live state; set
  // accepts a serialized state or a plain object, re-hydrates, persists and
  // re-renders the view matching the new phase.
  window.__contestState = {
    get: () => (state ? api.serialize(state) : null),
    set: (next) => {
      const json = typeof next === "string" ? next : JSON.stringify(next);
      state = api.deserialize(json);
      persist();
      if (state.phase === "playing" || state.phase === "frozen") {
        showView("#view-play");
        renderBoard();
        renderWinner();
      } else {
        showView("#view-setup");
        renderSetup();
      }
      return api.serialize(state);
    },
  };
}

boot();
