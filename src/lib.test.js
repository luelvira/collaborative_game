import { it, expect } from 'vitest'
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  colorHue,
  colorFor,
  colorName,
  groupName,
  makeId,
  pickGroup,
  newState,
  setGroupCount,
  renameGroup,
  startContest,
  endContest,
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
  MAX_HISTORY,
  rowSizes,
} from "./lib.js";

it("makeId produces string ids from Math.random alone (no crypto, no secure context)", () => {
  const ids = new Set(Array.from({ length: 200 }, () => makeId()));
  expect(ids.size).toBe(200);
  for (const id of ids) expect(typeof id).toBe("string");
  expect(ids.size).toBeGreaterThan(0);
});

it("lib source references no crypto at all", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const srcPath = resolve(__dirname, "./lib.js");
  const src = readFileSync(srcPath, "utf8");
  expect(src.includes("crypto")).toBe(false);
});

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

it("colorHue splits the wheel evenly", () => {
  expect(
    [0, 1, 2, 3].map((i) => colorHue(10, 4, i)),
  ).toEqual([10, 100, 190, 280]);
});

it("colorHue wraps modulo 360", () => {
  expect(colorHue(350, 4, 2)).toBe(170);
});

it("colorFor returns hsl with constant saturation and lightness", () => {
  const state = newState(() => 0.5);
  setGroupCount(state, 3, () => 0.5);
  const id = state.groups[0].id;
  expect(colorFor(state.startHue, state.groups, id)).toBe("hsl(180, 90%, 60%)");
});

it("colorName buckets every 30 degrees over the whole wheel", () => {
  expect(colorName(10)).toBe("red");
  expect(colorName(350)).toBe("red");
  expect(colorName(40)).toBe("orange");
  expect(colorName(80)).toBe("lime");
  expect(colorName(180)).toBe("cyan");
  expect(colorName(300)).toBe("magenta");
});

it("newState seeds in setup with two color-named groups and a startHue", () => {
  const state = newState(() => 0.5);
  expect(state.phase).toBe("setup");
  expect(state.groups.length).toBe(2);
  expect(state.startHue).toBe(180);
  expect(state.groups[0].name).toBe("cyan");
  expect(state.groups[1].name).toBe("red");
  expect(state.groups[0].id).not.toBe(state.groups[1].id);
  expect(state.startedAt > 0).toBe(true);
});

it("setGroupCount recreates N color-named groups, keeping an existing startHue", () => {
  const state = newState(() => 0.5);
  const res = setGroupCount(state, 3, () => 0.5);
  expect(res).toEqual({ ok: true });
  expect(state.startHue).toBe(180);
  expect(state.groups.length).toBe(3);
  expect(state.groups[0].name).toBe("cyan");
  expect(state.groups[1].name).toBe("magenta");
  expect(state.groups[2].name).toBe("yellow");
});

it("renameGroup renames only in setup", () => {
  const state = newState();
  setGroupCount(state, 2, () => 0.5);
  addMember(state, state.groups[0].id, "alice");
  const id = state.groups[0].id;
  const res = renameGroup(state, id, "Team A");
  expect(res).toEqual({ ok: true });
  expect(state.groups[0].name).toBe("Team A");
  startContest(state);
  const res2 = renameGroup(state, id, "X");
  expect(res2.error).toBeDefined();
});

it("members can only be added/removed in setup", () => {
  const state = newState();
  setGroupCount(state, 2, () => 0.5);
  const id = state.groups[0].id;
  addMember(state, id, "alice");
  expect(state.groups.some((g) => g.members.includes("alice"))).toBe(true);
  startContest(state);
  const res = addMember(state, state.groups[0].id, "bob");
  expect(res.error).toBeDefined();
  const res2 = removeMember(state, state.groups[0].id, "alice");
  expect(res2.error).toBeDefined();
});

it("startContest requires minimum groups and at least one member", () => {
  const state = newState();
  setGroupCount(state, 2, () => 0.5);
  const res = startContest(state);
  expect(res.error).toBeDefined();
  addMember(state, state.groups[0].id, "alice");
  const res2 = startContest(state);
  expect(res2).toEqual({ ok: true });
  expect(state.phase).toBe("playing");
});

it("addPoints only works in playing phase", () => {
  const state = newState();
  setGroupCount(state, 2, () => 0.5);
  addMember(state, state.groups[0].id, "alice");
  const id = state.groups[0].id;
  const err = addPoints(state, id, 1);
  expect(err.error).toBeDefined();
  startContest(state);
  const ok = addPoints(state, id, 1);
  expect(ok).toEqual({ ok: true });
  endContest(state);
  const err2 = addPoints(state, id, 1);
  expect(err2.error).toBeDefined();
});

it("endContest moves from playing to frozen", () => {
  const state = newState();
  setGroupCount(state, 2, () => 0.5);
  addMember(state, state.groups[0].id, "alice");
  startContest(state);
  const res = endContest(state);
  expect(res).toEqual({ ok: true });
  expect(state.phase).toBe("frozen");
});

it("winners returns all tied top-scoring ids", () => {
  const state = newState();
  setGroupCount(state, 2, () => 0.5);
  const g0 = state.groups[0].id;
  const g1 = state.groups[1].id;
  addMember(state, g0, "alice", () => 0.99); // both empty -> goes to group1 (index 1)
  addMember(state, g1, "bob", () => 0.5); // group1 has 1, group0 has 0 -> min is group0 -> goes to group0
  startContest(state);
  const bobGroup = state.groups.find((g) => g.members.includes("bob"));
  const aliceGroup = state.groups.find((g) => g.members.includes("alice"));
  addPoints(state, bobGroup.id, 5);
  addPoints(state, aliceGroup.id, 5);
  const w = winners(state);
  expect(w.length).toBe(2);
  addPoints(state, bobGroup.id, 1);
  const w2 = winners(state);
  expect(w2.length).toBe(1);
});

it("archiveRun works", () => {
  const state = newState();
  setGroupCount(state, 2, () => 0.5);
  addMember(state, state.groups[0].id, "alice");
  startContest(state);
  addPoints(state, state.groups[0].id, 3);
  const run = archiveRun(state, 12345);
  expect(run.endedAt).toBe(12345);
  expect(run.groups.length).toBe(2);
});

it("rowSizes splits N into balanced rows of at most 3 cards", () => {
  expect(rowSizes(1)).toEqual([1]);
  expect(rowSizes(2)).toEqual([2]);
  expect(rowSizes(3)).toEqual([3]);
  expect(rowSizes(4)).toEqual([2, 2]);
  expect(rowSizes(5)).toEqual([3, 2]);
  expect(rowSizes(6)).toEqual([3, 3]);
  expect(rowSizes(7)).toEqual([3, 2, 2]);
  expect(rowSizes(8)).toEqual([3, 3, 2]);
  expect(rowSizes(9)).toEqual([3, 3, 3]);
  expect(rowSizes(10)).toEqual([3, 3, 2, 2]);
  expect(rowSizes(0)).toEqual([]);
});

it("history save/load round-trips runs", () => {
  const storage = fakeStorage();
  const state = newState();
  setGroupCount(state, 2, () => 0.5);
  addMember(state, state.groups[0].id, "alice");
  startContest(state);
  const run = archiveRun(state, 999);
  saveHistory(storage, [run]);
  expect(loadHistory(storage)).toEqual([run]);
});

it("saveHistory keeps only the latest MAX_HISTORY runs", () => {
  const storage = fakeStorage();
  const runs = Array.from({ length: MAX_HISTORY + 5 }, (_, i) => ({
    startedAt: i,
    endedAt: i + 1,
    groups: [],
    winners: [],
  }));
  saveHistory(storage, runs);
  const loaded = loadHistory(storage);
  expect(loaded.length).toBe(MAX_HISTORY);
});
