import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import { newState, addGroup, addMember, addPoints, serialize } from "./lib.js";

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
