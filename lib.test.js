import test from "node:test";
import assert from "node:assert/strict";
import "./lib.js";

const {
  colorHue,
  colorFor,
  colorName,
  groupName,
  pickGroup,
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
} = globalThis.ContestLib;

function fakeState() {
  return newState(() => 0.5);
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test("colorHue splits the wheel evenly", () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => colorHue(10, 4, i)),
    [10, 100, 190, 280],
  );
});

test("colorHue wraps modulo 360", () => {
  assert.equal(colorHue(350, 4, 2), 170);
});

test("colorFor returns hsl with constant saturation and lightness", () => {
  const state = fakeState();
  addGroup(state, "Reds");
  const id = state.groups[0].id;
  assert.equal(colorFor(state.startHue, state.groups, id), "hsl(180, 70%, 55%)");
});

test("colorName buckets every 30 degrees over the whole wheel", () => {
  assert.equal(colorName(10), "red");
  assert.equal(colorName(350), "red"); // wrap
  assert.equal(colorName(40), "orange");
  assert.equal(colorName(80), "lime");
  assert.equal(colorName(180), "cyan");
  assert.equal(colorName(300), "magenta");
});

test("addGroup names the group after its color when no name is given", () => {
  const state = fakeState(); // startHue 180
  addGroup(state);
  // one group: hue 180 -> cyan
  assert.equal(groupName(state.startHue, state.groups, state.groups[0].id), "cyan");
  assert.equal(state.groups[0].name, undefined); // name stays derived, never baked
  addGroup(state);
  // two groups: 180 and 360(0) -> cyan and red
  const [first, second] = state.groups;
  assert.equal(groupName(state.startHue, state.groups, second.id), "red");
  addGroup(state);
  // three groups: re-split hues 180, 300, 60 -> cyan, magenta, yellow
  const third = state.groups[2];
  assert.equal(groupName(state.startHue, state.groups, third.id), "yellow");
});

test("pickGroup picks from minimum-size groups only", () => {
  // candidates among min are indexes 1 and 3; rng 0 -> first candidate
  assert.equal(pickGroup(() => 0, [2, 1, 2, 1]), 1);
  // rng 0.99 -> last candidate
  assert.equal(pickGroup(() => 0.99, [2, 1, 2, 1]), 3);
  // all equal -> any of them, resolved by rng
  assert.equal(pickGroup(() => 0, [0, 0, 0]), 0);
  assert.equal(pickGroup(() => 0.99, [0, 0, 0]), 2);
});

test("newState starts in setup with empty groups and rng-driven startHue", () => {
  const state = fakeState();
  assert.equal(state.phase, "setup");
  assert.deepEqual(state.groups, []);
  assert.equal(state.startHue, 180);
  assert.ok(state.startedAt > 0);
});

test("addGroup allows up to 6 groups and rejects the 7th", () => {
  const state = fakeState();
  for (let i = 0; i < 6; i++) {
    assert.deepEqual(addGroup(state, `G${i}`), { ok: true });
  }
  assert.equal(addGroup(state, "G6").error !== undefined, true);
  assert.equal(state.groups.length, 6);
});

test("removeGroup refuses a group with members, allows an empty one", () => {
  const state = fakeState();
  addGroup(state, "A");
  addGroup(state, "B");
  addMember(state, state.groups[0].id, "alice");
  // find which lowest-population group actually received the member
  const carrier = state.groups.find((g) => g.members.length > 0);
  assert.ok(carrier);
  assert.equal(removeGroup(state, carrier.id).error !== undefined, true);
  const other = state.groups.find((g) => g.members.length === 0);
  assert.deepEqual(removeGroup(state, other.id), { ok: true });
  assert.equal(state.groups.length, 1);
});

test("addMember rejects unknown group and empty name", () => {
  const state = fakeState();
  assert.equal(addMember(state, "nope", "x").error !== undefined, true);
  addGroup(state, "A");
  const id = state.groups[0].id;
  assert.equal(addMember(state, id, "   ").error !== undefined, true);
  assert.deepEqual(state.groups[0].members, []);
});

test("addMember sends the name to a minimum-size group", () => {
  const state = fakeState();
  addGroup(state, "A");
  addGroup(state, "B");
  const [a, b] = state.groups;
  // seeded rng -> first min-size group
  addMember(state, b.id, "orange", () => 0);
  assert.deepEqual(a.members, ["orange"]);
  // now both have 1; rng -> last candidate (the one with id b)
  addMember(state, b.id, "pear", () => 0.99);
  assert.deepEqual(b.members, ["pear"]);
});

test("removeMember removes a specific name and rejects unknown names", () => {
  const state = fakeState();
  addGroup(state, "A");
  const id = state.groups[0].id;
  addMember(state, id, "alice");
  addMember(state, id, "bob");
  assert.equal(removeMember(state, id, "ghost").error !== undefined, true);
  assert.deepEqual(removeMember(state, id, "alice"), { ok: true });
  assert.deepEqual(state.groups[0].members, ["bob"]);
});

test("addPoints accepts negatives and rejects junk amounts and unknown ids", () => {
  const state = fakeState();
  addGroup(state, "A");
  const id = state.groups[0].id;
  assert.equal(addPoints(state, "nope", 5).error !== undefined, true);
  assert.equal(addPoints(state, id, NaN).error !== undefined, true);
  assert.equal(addPoints(state, id, 2.5).error !== undefined, true);
  assert.deepEqual(addPoints(state, id, 5), { ok: true });
  assert.deepEqual(addPoints(state, id, -2), { ok: true });
  assert.equal(state.groups[0].points, 3);
});

test("winners returns all tied top-scoring ids and [] on empty board", () => {
  const state = fakeState();
  assert.deepEqual(winners(state), []);
  addGroup(state, "A");
  addGroup(state, "B");
  const [a, b] = state.groups;
  addPoints(state, a.id, 5);
  addPoints(state, b.id, 5);
  assert.deepEqual(winners(state).sort(), [a.id, b.id].sort());
  addPoints(state, a.id, 1);
  assert.deepEqual(winners(state), [a.id]);
});

test("serialize/deserialize round-trips startedAt, phase and groups", () => {
  const state = fakeState();
  addGroup(state, "A");
  addGroup(state, "B");
  addMember(state, state.groups[0].id, "alice");
  addPoints(state, state.groups[0].id, 3);
  const restored = deserialize(serialize(state));
  assert.equal(restored.startedAt, state.startedAt);
  assert.equal(restored.phase, state.phase);
  assert.equal(restored.startHue, state.startHue);
  assert.deepEqual(restored.groups, state.groups);
});

test("archiveRun captures start, end, groups and winners", () => {
  const state = fakeState();
  addGroup(state);          // cyan (hue 180)
  addGroup(state);          // red (hue 0)
  addPoints(state, state.groups[0].id, 4);
  addPoints(state, state.groups[1].id, 4);
  const run = archiveRun(state, 12345);
  assert.equal(run.startedAt, state.startedAt);
  assert.equal(run.endedAt, 12345);
  assert.equal(run.groups.length, 2);
  // names baked into the snapshot so history stays readable after reset
  assert.deepEqual(run.groups.map((g) => g.name).sort(), ["cyan", "red"]);
  assert.deepEqual(run.winners.sort(), state.groups.map((g) => g.id).sort());
});

test("history save/load round-trips runs", () => {
  const storage = fakeStorage();
  const state = fakeState();
  addGroup(state, "A");
  const run = archiveRun(state, 999);
  saveHistory(storage, [run]);
  assert.deepEqual(loadHistory(storage), [run]);
});

test("loadHistory returns [] when nothing stored", () => {
  assert.deepEqual(loadHistory(fakeStorage()), []);
});
