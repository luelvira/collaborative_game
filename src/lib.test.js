import { it, expect } from 'vitest'
import {
  colorHue,
  colorFor,
  colorName,
  groupName,
  makeId,
  newState,
  setGroupCount,
  renameGroup,
  redistributeMembers,
  startContest,
  endContest,
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
  initialRound,
  setQuestion,
  startRound,
  expireRound,
  awardPoints,
  undoLastAward,
  nextQuestion,
} from "./lib.js";

it("makeId produces string ids from Math.random alone", () => {
  const ids = new Set(Array.from({ length: 200 }, () => makeId()));
  expect(ids.size).toBe(200);
  for (const id of ids) expect(typeof id).toBe("string");
  expect(ids.size).toBeGreaterThan(0);
});

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

it.each([
  [2, [10, 190]],
  [3, [10, 130, 250]],
  [4, [10, 100, 190, 280]],
  [5, [10, 82, 154, 226, 298]],
  [6, [10, 70, 130, 190, 250, 310]],
  [7, [10, 61, 113, 164, 216, 267, 319]],
  [8, [10, 55, 100, 145, 190, 235, 280, 325]],
  [9, [10, 50, 90, 130, 170, 210, 250, 290, 330]],
  [10, [10, 46, 82, 118, 154, 190, 226, 262, 298, 334]],
])("colorHue splits the wheel with %d groups", (n, e) => {
  // spacing is 360/n (NOT floor 360/n): 7 groups step 51.43° with rounding.
  expect(
    Array.from({ length: n }, (_, i) => colorHue(10, n, i)),
  ).toEqual(e);
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


it("newState seeds in setup with two color-named groups and a startHue", () => {
  const state = newState(() => 0.5);
  expect(state.phase).toBe("setup");
  expect(state.groups.length).toBe(2);
  expect(state.startHue).toBe(180);
  expect(state.groups[0].name).toBe("cian eléctrico");
  expect(state.groups[1].name).toBe("rojo coral");
  expect(state.groups[0].id).not.toBe(state.groups[1].id);
  expect(state.startedAt > 0).toBe(true);
});

it("setGroupCount recreates N color-named groups, keeping an existing startHue", () => {
  const state = newState(() => 0.5);
  const res = setGroupCount(state, 3, () => 0.5);
  expect(res).toEqual({ ok: true });
  expect(state.startHue).toBe(180);
  expect(state.groups.length).toBe(3);
  // auto names derive from the new wheel split (raw name may be null now);
  // hue 180 in 3 groups spreads [180, 300, 60] → cian eléctrico, magenta,
  // amarillo limón
  expect(groupName(state.startHue, state.groups, state.groups[0].id)).toBe("cian eléctrico");
  expect(groupName(state.startHue, state.groups, state.groups[1].id)).toBe("magenta");
  expect(groupName(state.startHue, state.groups, state.groups[2].id)).toBe("amarillo limón");
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

// Helper: a state in the playing phase with one member in group 0.
function playingState() {
  const state = newState();
  setGroupCount(state, 2, () => 0.5);
  addMember(state, state.groups[0].id, "alice");
  startContest(state);
  return state;
}

it("colorName returns the Spanish names with 30-wide buckets starting at rojo coral=0", () => {
  expect(colorName(0)).toBe("rojo coral");
  expect(colorName(30)).toBe("naranja mandarina");
  expect(colorName(60)).toBe("amarillo limón");
  expect(colorName(90)).toBe("verde lima");
  expect(colorName(120)).toBe("verde neón");
  expect(colorName(150)).toBe("turquesa");
  expect(colorName(180)).toBe("cian eléctrico");
  expect(colorName(210)).toBe("azul cielo");
  expect(colorName(240)).toBe("azul eléctrico");
  expect(colorName(270)).toBe("púrpura intenso");
  expect(colorName(300)).toBe("magenta");
  expect(colorName(330)).toBe("rosa chicle");
});

it("initialRound defaults to 30 seconds in draft", () => {
  expect(initialRound()).toEqual({
    question: "",
    seconds: 30,
    phase: "draft",
    undoLog: [],
    expired: false,
    logStart: 0,
  });
  expect(initialRound(15).seconds).toBe(15);
});

it("newState seeds a draft round of 30 seconds", () => {
  const state = newState();
  expect(state.round.phase).toBe("draft");
  expect(state.round.seconds).toBe(30);
  expect(state.round.question).toBe("");
  expect(state.round.expired).toBe(false);
  expect(state.round.undoLog).toEqual([]);
});

it("setQuestion trims the text, requires playing phase, allows empty in draft", () => {
  const state = playingState();
  const res = setQuestion(state, "  ¿Capital de Francia?  ");
  expect(res).toEqual({ ok: true });
  expect(state.round.question).toBe("¿Capital de Francia?");
  expect(state.round.phase).toBe("draft");
  expect(setQuestion(state, "")).toEqual({ ok: true });
  expect(state.round.question).toBe("");
  const frozen = playingState();
  endContest(frozen);
  expect(setQuestion(frozen, "hola").error).toBe("Concurso no en juego");
});

it("setQuestion is only allowed while the round is in draft", () => {
  const state = playingState();
  setQuestion(state, "¿Cuánto es 2+2?");
  startRound(state);
  const res = setQuestion(state, "¿Cambiada en directo?");
  expect(res).toEqual({ error: "La ronda no está en borrador" });
  expect(state.round.question).toBe("¿Cuánto es 2+2?");
  // Same restriction from expired and answered.
  expireRound(state);
  expect(setQuestion(state, "x").error).toBe("La ronda no está en borrador");
  awardPoints(state, state.groups[0].id);
  expect(setQuestion(state, "x").error).toBe("La ronda no está en borrador");
  expect(state.round.question).toBe("¿Cuánto es 2+2?");
  // Back to draft: editing works again.
  nextQuestion(state);
  expect(setQuestion(state, "Nueva")).toEqual({ ok: true });
  expect(state.round.question).toBe("Nueva");
});

it("startRound requires playing, a non-empty question, and goes live", () => {
  const state = newState();
  setGroupCount(state, 2, () => 0.5);
  addMember(state, state.groups[0].id, "alice");
  expect(startRound(state).error).toBe("Concurso no en juego");
  startContest(state);
  setQuestion(state, "   ");
  expect(startRound(state).error).toBe("Pregunta vacía");
  setQuestion(state, "¿Cuánto es 2+2?");
  expect(startRound(state)).toEqual({ ok: true });
  expect(state.round.phase).toBe("live");
  expect(startRound(state).error).toBeDefined();
});

it("expireRound moves live to expired exactly once", () => {
  const state = playingState();
  expect(expireRound(state).error).toBeDefined();
  setQuestion(state, "¿5×5?");
  startRound(state);
  expect(expireRound(state)).toEqual({ ok: true });
  expect(state.round.phase).toBe("expired");
  expect(expireRound(state).error).toBeDefined();
});

it("expireRound sets a persisted expired flag that round-trips through JSON", () => {
  const state = playingState();
  setQuestion(state, "¿5×5?");
  startRound(state);
  expect(state.round.expired).toBe(false);
  expect(expireRound(state)).toEqual({ ok: true });
  expect(state.round.expired).toBe(true);
  // The flag survives serialize/deserialize (the whole bug: it lived in a
  // module variable and died on refresh).
  const restored = deserialize(serialize(state));
  expect(restored.round.expired).toBe(true);
  expect(restored.round.phase).toBe("expired");
});

it("nextQuestion clears the expired flag back to draft defaults", () => {
  const state = playingState();
  setQuestion(state, "¿5×5?");
  startRound(state);
  expireRound(state);
  expect(state.round.expired).toBe(true);
  expect(nextQuestion(state)).toEqual({ ok: true });
  expect(state.round.expired).toBe(false);
});

it("awardPoints validates like addPoints and works from draft, live and expired", () => {
  const state = playingState();
  const id = state.groups[0].id;
  // Timer never started: awarding from draft is allowed.
  expect(state.round.phase).toBe("draft");
  expect(awardPoints(state, id)).toEqual({ ok: true });
  expect(state.groups[0].points).toBe(1);
  expect(state.round.phase).toBe("answered");

  startRound(state);
  expect(awardPoints(state, id)).toEqual({ ok: true });
  expect(state.groups[0].points).toBe(2);

  expireRound(state);
  expect(awardPoints(state, id)).toEqual({ ok: true });
  expect(state.groups[0].points).toBe(3);

  const frozen = playingState();
  const other = frozen.groups[1].id;
  endContest(frozen);
  expect(awardPoints(frozen, other).error).toBe("Concurso no en juego");
  const playing = playingState();
  expect(awardPoints(playing, "nope").error).toBe("Grupo desconocido");
  expect(awardPoints(playing, playing.groups[0].id, 1.5).error).toBe(
    "Cantidad no válida",
  );
  expect(awardPoints(playing, playing.groups[0].id, Infinity).error).toBe(
    "Cantidad no válida",
  );
});

it("awardPoints appends entries in order across double awards", () => {
  const state = playingState();
  const a = state.groups[0].id;
  const b = state.groups[1].id;
  awardPoints(state, a);
  awardPoints(state, b, 2);
  expect(state.round.undoLog.length).toBe(2);
  expect(state.round.undoLog).toEqual([
    { groupId: a, amount: 1 },
    { groupId: b, amount: 2 },
  ]);
});

it("awardPoints caps undoLog at 20 entries, dropping the oldest", () => {
  const state = playingState();
  const id = state.groups[0].id;
  const amounts = Array.from({ length: 25 }, (_, i) => i + 1);
  for (const amount of amounts) awardPoints(state, id, amount);
  expect(state.round.undoLog.length).toBe(20);
  expect(state.round.undoLog[0]).toEqual({ groupId: id, amount: 6 });
  expect(state.round.undoLog[19]).toEqual({ groupId: id, amount: 25 });
});

it("undoLastAward pops the newest entry first and reverts points", () => {
  const state = playingState();
  const a = state.groups[0].id;
  const b = state.groups[1].id;
  awardPoints(state, a, 3);
  awardPoints(state, b, 2);
  const res1 = undoLastAward(state);
  expect(res1.ok).toBe(true);
  expect(res1.undone).toEqual({ groupId: b, amount: 2 });
  expect(state.groups[1].points).toBe(0);
  const res2 = undoLastAward(state);
  expect(res2.undone).toEqual({ groupId: a, amount: 3 });
  expect(state.groups[0].points).toBe(0);
  expect(undoLastAward(state)).toEqual({ error: "Nada que deshacer" });
  // Undoing must not flip the round phase by itself.
  expect(state.round.phase).toBe("answered");
});

it("undoLastAward reverts an award from a previous question (log survives nextQuestion)", () => {
  const state = playingState();
  const id = state.groups[0].id;
  awardPoints(state, id, 1);
  nextQuestion(state);
  const res = undoLastAward(state);
  expect(res.ok).toBe(true);
  expect(res.undone.groupId).toBe(id);
  expect(state.groups[0].points).toBe(0);
});

it("nextQuestion keeps past awards undoable but moves the message window (logStart)", () => {
  const state = playingState();
  const id = state.groups[0].id;
  awardPoints(state, id, 1);
  expect(nextQuestion(state)).toEqual({ ok: true });
  // the stale award stays in the log (still undoable)...
  expect(state.round.undoLog.length).toBe(1);
  expect(state.round.logStart).toBe(1);
  // ...but the current question's award window is empty
  expect(state.round.undoLog.slice(state.round.logStart)).toEqual([]);
  // a second award lands inside the window
  awardPoints(state, id, 2);
  expect(state.round.undoLog.slice(state.round.logStart)).toEqual([
    { groupId: id, amount: 2 },
  ]);
});

it("nextQuestion clears the question and returns to draft, keeping seconds and undoLog", () => {
  const state = playingState();
  const id = state.groups[0].id;
  setQuestion(state, "¿5×5?");
  state.round.seconds = 45;
  startRound(state);
  expireRound(state);
  awardPoints(state, id, 1);
  expect(nextQuestion(state)).toEqual({ ok: true });
  expect(state.round.question).toBe("");
  expect(state.round.phase).toBe("draft");
  expect(state.round.seconds).toBe(45);
  expect(state.round.undoLog.length).toBe(1);
  expect(nextQuestion(state).error).toBeUndefined();
  const frozen = playingState();
  endContest(frozen);
  expect(nextQuestion(frozen).error).toBe("Concurso no en juego");
});

it("endContest discards the round and freezes", () => {
  const state = playingState();
  setQuestion(state, "¿Cuánto es 2+2?");
  startRound(state);
  awardPoints(state, state.groups[0].id);
  expect(endContest(state)).toEqual({ ok: true });
  expect(state.phase).toBe("frozen");
  expect(state.round).toEqual({
    question: "",
    seconds: 30,
    phase: "draft",
    undoLog: [],
    expired: false,
    logStart: 0,
  });
  expect(endContest(state).error).toBeDefined();
});

it("deserialize hydrates a missing empty round without touching groups or points", () => {
  const state = playingState();
  delete state.round;
  const oldState = { question: "¿Qué acabamos de hacer?", seconds: 30 };
  Object.assign(oldState, JSON.parse(serialize(state)));
  delete oldState.round;
  const restored = deserialize(JSON.stringify(oldState));
  expect(restored.round.phase).toBe("draft");
  expect(restored.round.seconds).toBe(30);
  expect(restored.groups).toEqual(state.groups);
  expect(restored.phase).toBe(state.phase);
  // A round present but missing phase is also hydrated.
  const broken = { ...state, round: { question: "x", seconds: 30 } };
  const restored2 = deserialize(JSON.stringify(broken));
  expect(restored2.round.phase).toBe("draft");
});

// === Redistribution when the group count changes (players must persist) ===
it("redistributeMembers spreads t members over n targets as balanced floor/ceil", () => {
  const [a, b, c] = [
    { members: ["a1", "a2"] },
    { members: [] },
    { members: [] },
  ];
  const res = redistributeMembers([a, b, c], [a, b, c]);
  expect(res.map((members) => members.length)).toEqual([1, 1, 0]);
  expect([...res.flat()].sort()).toEqual(["a1", "a2"]);
});

it("growing groups keeps all players and balances them, nobody lost", () => {
  const state = newState(() => 0.5);
  setGroupCount(state, 3, () => 0.5);
  state.groups[0].members = ["ana", "brie", "carl", "dana", "evan"];
  state.groups[1].members = ["fay"];
  const idsBefore = state.groups.map((g) => g.id);
  const res = setGroupCount(state, 5, () => 0.5);
  expect(res).toEqual({ ok: true });
  expect(state.groups.length).toBe(5);
  const all = state.groups.flatMap((g) => g.members);
  expect(all.sort()).toEqual(
    ["ana", "brie", "carl", "dana", "evan", "fay"].sort(),
  );
  // survivors keep their identity (ids and names), new ones join at the end
  expect(state.groups.slice(0, 3).map((g) => g.id)).toEqual(idsBefore);
  expect(state.groups.map((g) => g.members.length).sort((x, y) => x - y))
    .toEqual([1, 1, 1, 1, 2]);
  // first survivors keep their members: G0 had 5 → keeps ceil(6/5)=2? The
  // balanced split of 6 over 5 is [2,1,1,1,1]; G0 keeps 2, the rest spread.
  expect(state.groups[0].members[0]).toBe("ana");
});

it("shrinking groups folds the last ones into the survivors with minimal moves", () => {
  const state = newState(() => 0.5);
  setGroupCount(state, 3, () => 0.5);
  state.groups[0].members = ["ana", "brie"];
  state.groups[1].members = ["carl", "dana"];
  state.groups[2].members = ["evan", "fay", "gus"];
  state.groups[0].name = "Alpha";
  state.groups[1].name = "Bravo";
  state.groups[2].name = "Charlie";
  const idsBefore = state.groups.slice(0, 2).map((g) => g.id);
  const res = setGroupCount(state, 2, () => 0.5);
  expect(res).toEqual({ ok: true });
  expect(state.groups.length).toBe(2);
  const all = state.groups.flatMap((g) => g.members);
  expect(all.sort()).toEqual(
    ["ana", "brie", "carl", "dana", "evan", "fay", "gus"].sort(),
  );
  // named survivors keep their names; identities preserved positionally
  expect(state.groups.map((g) => g.name)).toEqual(["Alpha", "Bravo"]);
  expect(state.groups.map((g) => g.id)).toEqual(idsBefore);
  // minimal moves: A and B each keep min(2, size) of their own members, so
  // only Charlie's 3 (+1 displaced) cross groups. Total 7 over 2 → [4,3].
  expect(state.groups[0].members[0]).toBe("ana");
  expect(state.groups[1].members[0]).toBe("carl");
});

it("redistributeMembers keeps the proven max of players in place", () => {
  // 5 members in G0, 0 elsewhere, shrinking 3 → 2: sizes [3,2] keep G0's 3
  // at home; the other 2 move exactly once. Nothing is reset or lost.
  const g0 = { members: ["p1", "p2", "p3", "p4", "p5"] };
  const g1 = { members: [] };
  const g2 = { members: [] };
  const res = redistributeMembers([g0, g1, g2], [g0, g1]);
  expect(res[0]).toEqual(["p1", "p2", "p3"]);
  expect(res[1]).toEqual(["p4", "p5"]);
});

it("teacher-set names survive the redistribution while auto names re-derive", () => {
  const state = newState(() => 0.5);
  setGroupCount(state, 3, () => 0.5);
  renameGroup(state, state.groups[1].id, "Bravo");
  setGroupCount(state, 2, () => 0.5);
  expect(groupName(state.startHue, state.groups, state.groups[0].id)).toBe("cian eléctrico");
  expect(groupName(state.startHue, state.groups, state.groups[1].id)).toBe("Bravo");
});

it("the whole redistribution survives serialize/deserialize untouched", () => {
  const state = newState();
  setGroupCount(state, 3, () => 0.5);
  state.groups[0].members = ["ana", "brie", "carl"];
  setGroupCount(state, 2, () => 0.5);
  const restored = deserialize(serialize(state));
  expect(restored.groups.flatMap((g) => g.members).sort()).toEqual(
    ["ana", "brie", "carl"].sort(),
  );
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
