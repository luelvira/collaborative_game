"use strict";

const MAX_GROUPS = 10;
const MIN_GROUPS = 2;
const MAX_HISTORY = 20;
const HISTORY_KEY = "contestBoard:history";
// 12 hue buckets of 30 degrees each, named clockwise from rojo at 0.
const COLOR_NAMES = [
  "rojo", "naranja", "amarillo", "lima", "verde", "turquesa",
  "cian", "celeste", "azul", "violeta", "magenta", "rosa",
];

export function colorHue(startHue, count, index) {
  return Math.round((startHue + (index * 360) / count) % 360);
}

export function colorName(hue) {
  // Bucket n covers [n*30, (n+1)*30): rojo starts at 0, naranja at 30, ...
  const normalized = ((hue % 360) + 360) % 360;
  return COLOR_NAMES[Math.floor(normalized / 30)];
}

function groupIndex(groups, id) {
  return groups.findIndex((g) => g.id === id);
}

// Name of a group on the current wheel split: explicit name if set,
// otherwise derived from its color so label and color never disagree.
export function groupName(startHue, groups, id) {
  const index = groupIndex(groups, id);
  if (index === -1 || startHue == null || groups.length === 0) return "";
  return groups[index].name ?? colorName(colorHue(startHue, groups.length, index));
}

export function colorFor(startHue, groups, id) {
  const index = groupIndex(groups, id);
  if (index === -1 || startHue == null || groups.length === 0) return "transparent";
  return `hsl(${colorHue(startHue, groups.length, index)}, 90%, 60%)`;
}

export function pickGroup(rng, memberCounts) {
  const min = Math.min(...memberCounts);
  const candidates = [];
  memberCounts.forEach((count, i) => {
    if (count === min) candidates.push(i);
  });
  return candidates[Math.floor(rng() * candidates.length)];
}

// Process-lifetime guard so deterministic test rngs can't produce duplicate ids.
const usedIds = new Set();

// Ids need uniqueness, not secrecy: avoid the browser's
// secure-context UUID API so ids also work over plain LAN http or older
// browsers where that API is missing.
export function makeId(rng = Math.random) {
  let id;
  do {
    id =
      "g" +
      Date.now().toString(36) +
      Math.floor(rng() * 1e9).toString(36) +
      Math.floor(rng() * 1e9).toString(36);
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

export function newState(rng = Math.random) {
  // Setup starts immediately usable: two color-named groups, ready to rename
  // and fill with players (nothing persists until the user edits something).
  const startHue = rng() * 360;
  return {
    startedAt: Date.now(),
    phase: "setup",
    startHue,
    groups: makeGroups(startHue, MIN_GROUPS, rng),
    round: initialRound(),
  };
}

/** Create or resize to N groups; colors appear only once N is chosen. */
// Groups evenly spaced on the color wheel, auto-named by their hue.
function makeGroups(startHue, n, rng = Math.random) {
  const groups = [];
  for (let i = 0; i < n; i++) {
    const hue = colorHue(startHue, n, i);
    groups.push({
      id: makeId(rng),
      name: colorName(hue),
      members: [],
      points: 0,
    });
  }
  return groups;
}

export function setGroupCount(state, n, rng = Math.random) {
  if (state.phase !== "setup") return { error: "Fuera de la preparación" };
  if (!Number.isInteger(n) || n < MIN_GROUPS || n > MAX_GROUPS) {
    return { error: `Elige entre ${MIN_GROUPS} y ${MAX_GROUPS} grupos` };
  }
  if (state.groups.length === n && state.startHue != null) return { ok: true };
  if (state.startHue == null) state.startHue = rng() * 360;
  state.groups = makeGroups(state.startHue, n, rng);
  return { ok: true };
}

export function renameGroup(state, id, name) {
  if (state.phase !== "setup") return { error: "Fuera de la preparación" };
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Grupo desconocido" };
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { error: "Nombre vacío" };
  group.name = trimmed;
  return { ok: true };
}

export function startContest(state) {
  if (state.phase !== "setup") return { error: "Fuera de la preparación" };
  if (state.groups.length < MIN_GROUPS) {
    return { error: `Se necesitan al menos ${MIN_GROUPS} grupos` };
  }
  const members = state.groups.reduce((sum, g) => sum + g.members.length, 0);
  if (members < 1) return { error: "Añade al menos un jugador" };
  state.phase = "playing";
  state.round = initialRound();
  return { ok: true };
}

export function endContest(state) {
  if (state.phase !== "playing") return { error: "Concurso no en juego" };
  state.phase = "frozen";
  // The in-flight question is discarded with the contest.
  state.round = initialRound(30);
  return { ok: true };
}

// Kept for tests / legacy; UI uses setGroupCount instead.
export function addGroup(state, name) {
  if (state.phase !== "setup") return { error: "Fuera de la preparación" };
  if (state.groups.length >= MAX_GROUPS) {
    return { error: `Máximo ${MAX_GROUPS} grupos` };
  }
  state.groups.push({ id: makeId(), name, members: [], points: 0 });
  return { ok: true };
}

export function removeGroup(state, id) {
  if (state.phase !== "setup") return { error: "Fuera de la preparación" };
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Grupo desconocido" };
  if (group.members.length > 0) return { error: "El grupo tiene jugadores" };
  state.groups = state.groups.filter((g) => g.id !== id);
  return { ok: true };
}

// The passed id only validates that a group exists; the actual target is
// always a minimum-population group, keeping assignments anti-starving.
export function addMember(state, id, name, rng = Math.random) {
  if (state.phase !== "setup") return { error: "Fuera de la preparación" };
  const carrier = state.groups.find((g) => g.id === id);
  if (!carrier) return { error: "Grupo desconocido" };
  if (!name || !name.trim()) return { error: "Nombre vacío" };
  const counts = state.groups.map((g) => g.members.length);
  const target = state.groups[pickGroup(rng, counts)];
  target.members.push(name.trim());
  return { ok: true };
}

export function removeMember(state, id, name) {
  if (state.phase !== "setup") return { error: "Fuera de la preparación" };
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Grupo desconocido" };
  if (!group.members.includes(name)) return { error: "Jugador desconocido" };
  group.members.splice(group.members.indexOf(name), 1);
  return { ok: true };
}

export function addPoints(state, id, amount) {
  if (state.phase !== "playing") return { error: "Concurso no en juego" };
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Grupo desconocido" };
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return { error: "Cantidad no válida" };
  }
  group.points += amount;
  return { ok: true };
}

export function initialRound(seconds = 30) {
  return { question: "", seconds, phase: "draft", undoLog: [] };
}

const UNDO_LOG_CAP = 20;

/** Every round mutation goes through these actions so the DOM only drives them. */

export function setQuestion(state, text) {
  if (state.phase !== "playing") return { error: "Concurso no en juego" };
  // Draft again from live/expired is the professor editing: keep it allowed.
  state.round.question = (text ?? "").trim();
  return { ok: true };
}

export function startRound(state) {
  if (state.phase !== "playing") return { error: "Concurso no en juego" };
  const round = state.round;
  if (!round || round.phase !== "draft") {
    return { error: "La ronda ya está en juego" };
  }
  if (!round.question.trim()) return { error: "Pregunta vacía" };
  round.phase = "live";
  return { ok: true };
}

export function expireRound(state) {
  if (state.phase !== "playing") return { error: "Concurso no en juego" };
  const round = state.round;
  if (!round || round.phase !== "live") {
    return { error: "La pregunta no está en directo" };
  }
  round.phase = "expired";
  return { ok: true };
}

export function awardPoints(state, id, amount = 1) {
  if (state.phase !== "playing") return { error: "Concurso no en juego" };
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Grupo desconocido" };
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return { error: "Cantidad no válida" };
  }
  group.points += amount;
  const round = state.round ?? (state.round = initialRound());
  round.undoLog.push({ groupId: id, amount });
  if (round.undoLog.length > UNDO_LOG_CAP) round.undoLog.shift();
  // The timer never restarts after a point; awarding also works from draft
  // (no timer started yet) and from expired.
  round.phase = "answered";
  return { ok: true };
}

export function undoLastAward(state) {
  const round = state.round;
  const entry = round?.undoLog?.pop();
  if (!entry) return { error: "Nada que deshacer" };
  const group = state.groups.find((g) => g.id === entry.groupId);
  if (group) group.points -= entry.amount;
  // No phase change: the professor keeps scoring or moves on.
  return { ok: true, undone: entry };
}

export function nextQuestion(state) {
  if (state.phase !== "playing") return { error: "Concurso no en juego" };
  // undoLog survives the change so an award can still be undone.
  const seconds = state.round ? state.round.seconds : 30;
  const undoLog = state.round ? state.round.undoLog : [];
  state.round = { ...initialRound(seconds), undoLog };
  return { ok: true };
}

export function winners(state) {
  if (state.groups.length === 0) return [];
  const max = Math.max(...state.groups.map((g) => g.points));
  return state.groups.filter((g) => g.points === max).map((g) => g.id);
}

export function archiveRun(state, endedAt = Date.now()) {
  const snapshot = state.groups.map((g) => ({
    ...g,
    members: [...g.members],
    name: groupName(state.startHue, state.groups, g.id),
  }));
  return {
    startedAt: state.startedAt,
    endedAt,
    groups: snapshot,
    winners: winners(state),
  };
}

export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(json) {
  const state = JSON.parse(json);
  // States saved before the redesign have no round (or a phaseless one):
  // hydrate to draft without touching groups or points.
  if (!state.round || !state.round.phase) state.round = initialRound(30);
  return state;
}

export function loadHistory(storage) {
  const raw = storage.getItem(HISTORY_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

export function saveHistory(storage, runs) {
  const trimmed = runs.length > MAX_HISTORY ? runs.slice(-MAX_HISTORY) : runs;
  storage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

export function hasSavedSession(storage) {
  const raw = storage.getItem("contestBoard:current");
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    return Boolean(s && Array.isArray(s.groups));
  } catch {
    return false;
  }
}

/** Balanced rows with at most 3 cards each: 10 → [3,3,2,2], 4 → [2,2]. */
export function rowSizes(n) {
  if (n <= 0) return [];
  const rows = Math.ceil(n / 3);
  const base = Math.floor(n / rows);
  const extras = n % rows;
  return Array.from({ length: rows }, (_, i) => (i < extras ? base + 1 : base));
}

export { MAX_GROUPS, MIN_GROUPS, MAX_HISTORY, HISTORY_KEY };
