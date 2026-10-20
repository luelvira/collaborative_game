const MAX_GROUPS = 6;
const HISTORY_KEY = "contestBoard:history";

export function colorHue(startHue, count, index) {
  return Math.round((startHue + (index * 360) / count) % 360);
}

export function colorFor(startHue, groups, id) {
  const index = groups.findIndex((g) => g.id === id);
  return `hsl(${colorHue(startHue, groups.length, index)}, 70%, 55%)`;
}

export function pickGroup(rng, memberCounts) {
  const min = Math.min(...memberCounts);
  const candidates = [];
  memberCounts.forEach((count, i) => {
    if (count === min) candidates.push(i);
  });
  return candidates[Math.floor(rng() * candidates.length)];
}

export function newState(rng = Math.random) {
  return {
    startedAt: Date.now(),
    phase: "setup",
    startHue: rng() * 360,
    groups: [],
  };
}

export function addGroup(state, name) {
  if (state.groups.length >= MAX_GROUPS) {
    return { error: `Maximum ${MAX_GROUPS} groups` };
  }
  state.groups.push({ id: crypto.randomUUID(), name, members: [], points: 0 });
  return { ok: true };
}

export function removeGroup(state, id) {
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Unknown group" };
  if (group.members.length > 0) return { error: "Group has members" };
  state.groups = state.groups.filter((g) => g.id !== id);
  return { ok: true };
}

export function addMember(state, id, name, rng = Math.random) {
  const carrier = state.groups.find((g) => g.id === id);
  if (!carrier) return { error: "Unknown group" };
  if (!name || !name.trim()) return { error: "Empty name" };
  const counts = state.groups.map((g) => g.members.length);
  const target = state.groups[pickGroup(rng, counts)];
  target.members.push(name.trim());
  return { ok: true };
}

export function removeMember(state, id, name) {
  const group = state.groups.find((g) => g.id === id);
  if (!group) return { error: "Unknown group" };
  if (!group.members.includes(name)) return { error: "Unknown member" };
  group.members.splice(group.members.indexOf(name), 1);
  return { ok: true };
}

export function addPoints(state, id, amount) {
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
  return {
    startedAt: state.startedAt,
    endedAt,
    groups: state.groups.map((g) => ({ ...g, members: [...g.members] })),
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
  storage.setItem(HISTORY_KEY, JSON.stringify(runs));
}
