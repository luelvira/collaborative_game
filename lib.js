"use strict";

globalThis.ContestLib = (function () {
  const MAX_GROUPS = 6;
  const HISTORY_KEY = "contestBoard:history";
  // 12 hue buckets of 30 degrees each, named clockwise from red at 0.
  const COLOR_NAMES = [
    "red", "orange", "yellow", "lime", "green", "teal",
    "cyan", "azure", "blue", "violet", "magenta", "rose",
  ];

  function colorHue(startHue, count, index) {
    return Math.round((startHue + (index * 360) / count) % 360);
  }

  function colorName(hue) {
    // Buckets are centered on the wheel's cardinal colors (0 = pure red, etc.)
    const normalized = ((hue % 360) + 375) % 360;
    return COLOR_NAMES[Math.floor(normalized / 30)];
  }

  function groupIndex(groups, id) {
    return groups.findIndex((g) => g.id === id);
  }

  // Name of a group on the current wheel split: explicit name if set,
  // otherwise derived from its color so label and color never disagree.
  function groupName(startHue, groups, id) {
    const index = groupIndex(groups, id);
    if (index === -1) return "";
    return groups[index].name ?? colorName(colorHue(startHue, groups.length, index));
  }

  function colorFor(startHue, groups, id) {
    const index = groupIndex(groups, id);
    return `hsl(${colorHue(startHue, groups.length, index)}, 70%, 55%)`;
  }

  function pickGroup(rng, memberCounts) {
    const min = Math.min(...memberCounts);
    const candidates = [];
    memberCounts.forEach((count, i) => {
      if (count === min) candidates.push(i);
    });
    return candidates[Math.floor(rng() * candidates.length)];
  }

  // Ids need uniqueness, not secrecy: avoid the browser's
  // secure-context UUID API so ids also work over plain LAN http or older
  // browsers where that API is missing.
  function makeId(rng = Math.random) {
    return (
      "g" +
      Date.now().toString(36) +
      Math.floor(rng() * 1e9).toString(36) +
      Math.floor(rng() * 1e9).toString(36)
    );
  }

  function newState(rng = Math.random) {
    return {
      startedAt: Date.now(),
      phase: "setup",
      startHue: rng() * 360,
      groups: [],
    };
  }

  function addGroup(state, name) {
    if (state.groups.length >= MAX_GROUPS) {
      return { error: `Maximum ${MAX_GROUPS} groups` };
    }
    state.groups.push({ id: makeId(), name, members: [], points: 0 });
    return { ok: true };
  }

  function removeGroup(state, id) {
    const group = state.groups.find((g) => g.id === id);
    if (!group) return { error: "Unknown group" };
    if (group.members.length > 0) return { error: "Group has members" };
    state.groups = state.groups.filter((g) => g.id !== id);
    return { ok: true };
  }

  // The passed id only validates that a group exists; the actual target is
  // always a minimum-population group, keeping assignments anti-starving.
  function addMember(state, id, name, rng = Math.random) {
    const carrier = state.groups.find((g) => g.id === id);
    if (!carrier) return { error: "Unknown group" };
    if (!name || !name.trim()) return { error: "Empty name" };
    const counts = state.groups.map((g) => g.members.length);
    const target = state.groups[pickGroup(rng, counts)];
    target.members.push(name.trim());
    return { ok: true };
  }

  function removeMember(state, id, name) {
    const group = state.groups.find((g) => g.id === id);
    if (!group) return { error: "Unknown group" };
    if (!group.members.includes(name)) return { error: "Unknown member" };
    group.members.splice(group.members.indexOf(name), 1);
    return { ok: true };
  }

  function addPoints(state, id, amount) {
    const group = state.groups.find((g) => g.id === id);
    if (!group) return { error: "Unknown group" };
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
      return { error: "Invalid amount" };
    }
    group.points += amount;
    return { ok: true };
  }

  function winners(state) {
    if (state.groups.length === 0) return [];
    const max = Math.max(...state.groups.map((g) => g.points));
    return state.groups.filter((g) => g.points === max).map((g) => g.id);
  }

  function archiveRun(state, endedAt = Date.now()) {
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

  function serialize(state) {
    return JSON.stringify(state);
  }

  function deserialize(json) {
    return JSON.parse(json);
  }

  function loadHistory(storage) {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  }

  function saveHistory(storage, runs) {
    storage.setItem(HISTORY_KEY, JSON.stringify(runs));
  }

  return {
    colorHue,
    colorName,
    groupName,
    colorFor,
    pickGroup,
    makeId,
    newState,
    addGroup,
    removeGroup,
    addMember,
    removeMember,
    addPoints,
    winners,
    archiveRun,
    serialize,
    deserialize,
    loadHistory,
    saveHistory,
  };
})();

// CommonJS compatibility so Node tooling can also require this file.
if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, ContestLib);
}