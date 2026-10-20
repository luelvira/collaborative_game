"use strict";

const MAX_GROUPS = 10;
const MIN_GROUPS = 2;
const MAX_HISTORY = 20;
const HISTORY_KEY = "contestBoard:history";
// 12 hue buckets of 30 degrees each, named clockwise from red at 0.
const COLOR_NAMES = [
  "red", "orange", "yellow", "lime", "green", "teal",
  "cyan", "azure", "blue", "violet", "magenta", "rose",
];

export function colorHue(startHue, count, index) {
  return Math.round((startHue + (index * 360) / count) % 360);
}

export function colorName(hue) {
  // Buckets are centered on the wheel's cardinal colors (0 = pure red, etc.)
  const normalized = ((hue % 360) + 375) % 360;
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
  if (state.phase !== "setup") return { error: "Not in setup" };
  if (!Number.isInteger(n) || n < MIN_GROUPS || n > MAX_GROUPS) {
    return { error: `Choose between ${MIN_GROUPS} and ${MAX_GROUPS} groups` };
  }
  if (state.groups.length === n && state.startHue != null) return { ok: true };
  if (state.startHue == null) state.startHue = rng() * 360;
  state.groups = makeGroups(state.startHue, n, rng);
  return { ok: true };
}

export function renameGroup(state, id, name) {
  if (state.phase !== "setup") return { error: "Not in setup" };
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Unknown group" };
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { error: "Empty name" };
  group.name = trimmed;
  return { ok: true };
}

export function startContest(state) {
  if (state.phase !== "setup") return { error: "Not in setup" };
  if (state.groups.length < MIN_GROUPS) {
    return { error: `Need at least ${MIN_GROUPS} groups` };
  }
  const members = state.groups.reduce((sum, g) => sum + g.members.length, 0);
  if (members < 1) return { error: "Add at least one player" };
  state.phase = "playing";
  return { ok: true };
}

export function endContest(state) {
  if (state.phase !== "playing") return { error: "Contest is not running" };
  state.phase = "frozen";
  return { ok: true };
}

// Kept for tests / legacy; UI uses setGroupCount instead.
export function addGroup(state, name) {
  if (state.phase !== "setup") return { error: "Not in setup" };
  if (state.groups.length >= MAX_GROUPS) {
    return { error: `Maximum ${MAX_GROUPS} groups` };
  }
  state.groups.push({ id: makeId(), name, members: [], points: 0 });
  return { ok: true };
}

export function removeGroup(state, id) {
  if (state.phase !== "setup") return { error: "Not in setup" };
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Unknown group" };
  if (group.members.length > 0) return { error: "Group has members" };
  state.groups = state.groups.filter((g) => g.id !== id);
  return { ok: true };
}

// The passed id only validates that a group exists; the actual target is
// always a minimum-population group, keeping assignments anti-starving.
export function addMember(state, id, name, rng = Math.random) {
  if (state.phase !== "setup") return { error: "Not in setup" };
  const carrier = state.groups.find((g) => g.id === id);
  if (!carrier) return { error: "Unknown group" };
  if (!name || !name.trim()) return { error: "Empty name" };
  const counts = state.groups.map((g) => g.members.length);
  const target = state.groups[pickGroup(rng, counts)];
  target.members.push(name.trim());
  return { ok: true };
}

export function removeMember(state, id, name) {
  if (state.phase !== "setup") return { error: "Not in setup" };
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Unknown group" };
  if (!group.members.includes(name)) return { error: "Unknown member" };
  group.members.splice(group.members.indexOf(name), 1);
  return { ok: true };
}

export function addPoints(state, id, amount) {
  if (state.phase !== "playing") return { error: "Contest is not running" };
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Unknown group" };
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return { error: "Invalid amount" };
  }
  group.points += amount;
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
  return JSON.parse(json);
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
