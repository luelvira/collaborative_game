import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import "./lib.js";

const {
  newState,
  addGroup,
  addMember,
  addPoints,
  serialize,
} = globalThis.ContestLib;

function bootWithSeededState(seedBuilder) {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8").replace(
    '<script type="module" src="app.js"></script>',
    "",
  );
  const { window, document } = parseHTML(html);
  const store = new Map();
  window.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const saved = { ...window };
  const priorDocument = globalThis.document;
  for (const [k, v] of Object.entries(saved)) {
    if (!(k in globalThis)) globalThis[k] = v;
  }
  globalThis.document = document;
  globalThis.window = window;
  globalThis.localStorage = window.localStorage;
  const state = seedBuilder();
  window.localStorage.setItem("contestBoard:current", serialize(state));
  return { window, document, store, cleanup: () => { globalThis.document = priorDocument; } };
}

function seedThreeGroupsSevenUsers() {
  const s = newState(() => 0.5);
  addGroup(s, "Alpha");
  addGroup(s, "Bravo");
  addGroup(s, "Charlie");
  for (const n of ["ana", "brie", "carl", "dana", "evan", "fay", "gus"]) {
    addMember(s, s.groups[0].id, n);
  }
  const [a, b, c] = s.groups;
  addPoints(s, a.id, 3);
  addPoints(s, b.id, 1);
  addPoints(s, c.id, 3);
  return s;
}

function frozenSeed() {
  const s = seedThreeGroupsSevenUsers();
  s.phase = "frozen";
  return s;
}

test("adding groups without typing names gives them their color names", async () => {
  const { document, window, store, cleanup } = bootWithSeededState(() => {
    const s = newState(() => 0.5); // startHue 180
    return s;
  });
  try {
    await appModule();
    document.querySelector("#add-group").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(document.querySelectorAll("#board .card").length, 1);
    assert.equal(document.querySelector("#board .card .card-head h3").textContent, "cyan");
    document.querySelector("#add-group").dispatchEvent(new window.Event("click", { bubbles: true }));
    const names = [...document.querySelectorAll("#board .card .card-head h3")].map((n) => n.textContent);
    assert.deepEqual(names, ["cyan", "red"]);
    // the group name input is gone; nothing to type
    assert.equal(document.querySelector("#group-name"), null);
  } finally {
    cleanup();
  }
});

test("adding a named group (via seeded state) still renders its name", async () => {
  const { document, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    await appModule();
    const names = [...document.querySelectorAll("#board .card .card-head h3")].map((n) => n.textContent);
    assert.deepEqual(names, ["Alpha", "Bravo", "Charlie"]);
  } finally {
    cleanup();
  }
});

test("end contest freezes the board and shows tied winners", async () => {
  const { document, window, store, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    await appModule();
    document.querySelector("#end-contest").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(document.querySelector("#winner").hidden, false);
    assert.match(document.querySelector("#winner-name").textContent, /Alpha.*Charlie|Charlie.*Alpha/);
    const cards = document.querySelectorAll("#board .card");
    for (const card of cards) {
      for (const btn of card.querySelectorAll("button")) assert.equal(btn.disabled, true);
    }
    assert.equal(document.querySelector("#add-user").disabled, true);
    const persisted = JSON.parse(store.get("contestBoard:current"));
    assert.equal(persisted.phase, "frozen");
  } finally {
    cleanup();
  }
});

test("reset archives the play with start timestamp and restarts", async () => {
  const { document, window, store, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    await appModule();
    document.querySelector("#end-contest").dispatchEvent(new window.Event("click", { bubbles: true }));
    const realConfirm = window.confirm;
    window.confirm = () => true;
    document.querySelector("#reset").dispatchEvent(new window.Event("click", { bubbles: true }));
    window.confirm = realConfirm;
    const runs = JSON.parse(store.get("contestBoard:history"));
    assert.equal(runs.length, 1);
    assert.ok(runs[0].startedAt > 0 && runs[0].endedAt >= runs[0].startedAt);
    assert.ok([1, 2].includes(runs[0].winners.length));
    const fresh = JSON.parse(store.get("contestBoard:current"));
    assert.equal(fresh.phase, "setup");
    assert.equal(fresh.groups.length, 0);
    assert.ok(fresh.startedAt > runs[0].startedAt);
    assert.equal(document.querySelector("#winner").hidden, true);
    assert.equal(document.querySelector("#history").hidden, false);
    assert.match(document.querySelector("#history").textContent, /Winner/);
  } finally {
    cleanup();
  }
});

test("loading a frozen state after refresh restores the winner view", async () => {
  const { document, cleanup } = bootWithSeededState(frozenSeed);
  try {
    await appModule();
    assert.equal(document.querySelector("#winner").hidden, false);
    const cards = document.querySelectorAll("#board .card");
    for (const card of cards) {
      for (const btn of card.querySelectorAll("button")) assert.equal(btn.disabled, true);
    }
  } finally {
    cleanup();
  }
});

test("boot renders one card per stored group with score and chip", async () => {
  const { document, store, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    await appModule();
    const cards = document.querySelectorAll("#board .card");
    assert.equal(cards.length, 3);
    const scores = [...cards].map((c) => c.querySelector(".score").textContent);
    const total = scores.reduce((acc, s) => acc + Number(s), 0);
    assert.equal(total, 7);
    const chips = [...cards].map((c) => c.querySelector(".chip").style.background);
    chips.forEach((c) => assert.match(c, /^hsl\(\d+, 70%, 55%\)$/));
    const hues = chips.map((c) => Number(c.match(/\d+/)[0]));
    assert.equal(Math.max(...hues) - Math.min(...hues) <= 240, true);
    // names visible in member lists
    const names = [...cards].map((c) => [...c.querySelectorAll(".members li span")].map((n) => n.textContent));
    assert.deepEqual(names.flat().sort(), ["ana", "brie", "carl", "dana", "evan", "fay", "gus"]);
  } finally {
    cleanup();
  }
});

test("a handler that throws shows the error as a visible toast, not a dead button", async () => {
  const { document, window, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    const original = globalThis.ContestLib.addMember;
    // sabotage BEFORE import: app.js destructures ContestLib at module eval
    globalThis.ContestLib.addMember = () => { throw new TypeError("boom"); };
    await appModule();
    const user = document.querySelector("#user-name");
    user.value = "zed";
    document.querySelector("#add-user").dispatchEvent(new window.Event("click", { bubbles: true }));
    globalThis.ContestLib.addMember = original;
    const toast = document.querySelector("#toast.show");
    assert.notEqual(toast, null);
    assert.match(document.querySelector("#toast").textContent, /boom/);
  } finally {
    cleanup();
  }
});

const appModule = () => import(`./app.js?t=${Date.now()}-${Math.random()}`);

test("clicking +1 updates the score and persists", async () => {
  const { document, store, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    await appModule();
    const firstCard = document.querySelector("#board .card");
    const scoreNode = firstCard.querySelector(".score");
    const before = Number(scoreNode.textContent);
    firstCard.querySelector('.points-row [data-delta="1"]').dispatchEvent(new window.Event("click", { bubbles: true }));
    // board is re-rendered after every mutation, so re-query the live card
    const freshScore = document.querySelector("#board .card .score");
    assert.equal(Number(freshScore.textContent), before + 1);
    const restored = JSON.parse(store.get("contestBoard:current"));
    const scored = restored.groups.map((g) => g.points);
    assert.equal(scored.reduce((a, b) => a + b, 0), 7 + 1);
  } finally {
    cleanup();
  }
});
