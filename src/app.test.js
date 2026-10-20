import { it, expect, vi } from 'vitest'
import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  newState,
  setGroupCount,
  addGroup,
  addMember,
  addPoints,
  startContest,
  endContest,
  serialize,
} from "./lib.js";

function bootWithSeededState(seedBuilder) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const htmlPath = resolve(__dirname, "../index.html");
  const html = readFileSync(htmlPath, "utf8").replace(
    /<script type="module" src="[^"]+"><\/script>/,
    "",
  );
  const { window, document } = parseHTML(html);
  const store = new Map();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    writable: true,
    configurable: true,
  });
  const saved = { ...window };
  const priorDocument = globalThis.document;
  for (const [k, v] of Object.entries(saved)) {
    if (!(k in globalThis)) globalThis[k] = v;
  }
  Object.defineProperty(globalThis, "document", {
    value: document,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: window,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: window.localStorage,
    writable: true,
    configurable: true,
  });
  const state = seedBuilder();
  window.localStorage.setItem("contestBoard:current", serialize(state));
  return {
    window,
    document,
    store,
    cleanup: () => {
      globalThis.document = priorDocument;
    },
  };
}

function seedThreeGroupsSevenUsers() {
  const s = newState();
  setGroupCount(s, 3, () => 0.5);
  for (const n of ["ana", "brie", "carl", "dana", "evan", "fay", "gus"]) {
    addMember(s, s.groups[0].id, n, () => 0);
    addMember(s, s.groups[0].id, n, () => 0);
    addMember(s, s.groups[0].id, n, () => 0);
    addMember(s, s.groups[0].id, n, () => 0);
    addMember(s, s.groups[0].id, n, () => 0);
    addMember(s, s.groups[0].id, n, () => 0);
    addMember(s, s.groups[0].id, n, () => 0);
  }
  // easier: just add directly by distributing
  s.groups[0].members = ["ana", "brie"];
  s.groups[1].members = ["carl", "dana"];
  s.groups[2].members = ["evan", "fay", "gus"];
  s.groups[0].name = "Alpha";
  s.groups[1].name = "Bravo";
  s.groups[2].name = "Charlie";
  startContest(s);
  addPoints(s, s.groups[0].id, 3);
  addPoints(s, s.groups[1].id, 1);
  addPoints(s, s.groups[2].id, 3);
  return s;
}

function frozenSeed() {
  const s = seedThreeGroupsSevenUsers();
  endContest(s);
  return s;
}

const appModule = async () => {
  vi.resetModules();
  return import("./app.js");
};

it("adding groups without typing names gives them their color names", async () => {
  const { document, window, store, cleanup } = bootWithSeededState(() => newState());
  try {
    const { api } = await appModule();
    document.querySelector("#fresh-session").dispatchEvent(new window.Event("click", { bubbles: true }));
    const gc = document.querySelector("#group-count");
    gc.value = "2";
    gc.dispatchEvent(new window.Event("change", { bubbles: true }));
    const saved = JSON.parse(store.get("contestBoard:current"));
    const expected = [0, 1].map((i) => api.colorName(api.colorHue(saved.startHue, 2, i)));
    const names = [...document.querySelectorAll("#setup-groups input.setup-group-name")].map((n) => n.value);
    expect(names.sort()).toEqual(expected.sort());
    expect(api).toBeDefined();
  } finally {
    cleanup();
  }
});

it("adding a named group (via seeded state) still renders its name", async () => {
  const { document, window, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    await appModule();
    document.querySelector("#continue-session").dispatchEvent(new window.Event("click", { bubbles: true }));
    const names = [...document.querySelectorAll("#board .card .card-head h3")].map((n) => n.textContent);
    expect(names.sort()).toEqual(["Alpha", "Bravo", "Charlie"].sort());
  } finally {
    cleanup();
  }
});

it("end contest freezes the board and shows tied winners", async () => {
  const { document, window, store, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    await appModule();
    document.querySelector("#continue-session").dispatchEvent(new window.Event("click", { bubbles: true }));
    document.querySelector("#end-contest").dispatchEvent(new window.Event("click", { bubbles: true }));
    expect(document.querySelector("#winner").hidden).toBe(false);
    expect(document.querySelector("#winner-name").textContent).toMatch(/Alpha|Charlie/);
    const persisted = JSON.parse(store.get("contestBoard:current"));
    expect(persisted.phase).toBe("frozen");
  } finally {
    cleanup();
  }
});

it("reset archives the play with start timestamp and restarts", async () => {
  const { document, window, store, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    await appModule();
    document.querySelector("#continue-session").dispatchEvent(new window.Event("click", { bubbles: true }));
    document.querySelector("#end-contest").dispatchEvent(new window.Event("click", { bubbles: true }));
    const realConfirm = window.confirm;
    window.confirm = () => true;
    document.querySelector("#reset").dispatchEvent(new window.Event("click", { bubbles: true }));
    window.confirm = realConfirm;
    const runs = JSON.parse(store.get("contestBoard:history"));
    expect(runs.length).toBe(1);
    expect(runs[0].startedAt > 0 && runs[0].endedAt >= runs[0].startedAt).toBe(true);
    expect([1, 2].includes(runs[0].winners.length)).toBe(true);
    const fresh = JSON.parse(store.get("contestBoard:current"));
    expect(fresh.phase).toBe("setup");
    expect(fresh.groups.length).toBe(0);
    expect(fresh.startedAt > runs[0].startedAt).toBe(true);
    expect(document.querySelector("#winner").hidden).toBe(true);
    expect(document.querySelector("#history").hidden).toBe(false);
  } finally {
    cleanup();
  }
});

it("loading a frozen state after refresh restores the winner view", async () => {
  const { document, window, cleanup } = bootWithSeededState(frozenSeed);
  try {
    await appModule();
    document.querySelector("#continue-session").dispatchEvent(new window.Event("click", { bubbles: true }));
    expect(document.querySelector("#winner").hidden).toBe(false);
  } finally {
    cleanup();
  }
});

it("boot renders one card per stored group with score and chip", async () => {
  const { document, window, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    await appModule();
    document.querySelector("#continue-session").dispatchEvent(new window.Event("click", { bubbles: true }));
    const cards = document.querySelectorAll("#board .card");
    expect(cards.length).toBe(3);
    const scores = [...cards].map((c) => c.querySelector(".score").textContent);
    const total = scores.reduce((acc, s) => acc + Number(s), 0);
    expect(total).toBe(7);
    const chips = [...cards].map((c) => c.querySelector(".chip").style.background);
    chips.forEach((c) => expect(c).toMatch(/^hsl\(\d+, 90%, 60%\)$/));
  } finally {
    cleanup();
  }
});

it("a handler that throws shows the error as a visible toast, not a dead button", async () => {
  const { document, window, cleanup } = bootWithSeededState(() => newState());
  try {
    const { api } = await appModule();
    document.querySelector("#fresh-session").dispatchEvent(new window.Event("click", { bubbles: true }));
    const gc = document.querySelector("#group-count");
    gc.value = "2";
    gc.dispatchEvent(new window.Event("change", { bubbles: true }));
    api.addMember = () => {
      throw new TypeError("boom");
    };
    const user = document.querySelector("#user-name");
    user.value = "zed";
    document.querySelector("#add-user").dispatchEvent(new window.Event("click", { bubbles: true }));
    const toast = document.querySelector("#toast.show");
    expect(toast).not.toBe(null);
  } finally {
    cleanup();
  }
});

it("clicking +1 updates the score and persists", async () => {
  const { document, window, store, cleanup } = bootWithSeededState(seedThreeGroupsSevenUsers);
  try {
    await appModule();
    document.querySelector("#continue-session").dispatchEvent(new window.Event("click", { bubbles: true }));
    const firstCard = document.querySelector("#board .card");
    const scoreNode = firstCard.querySelector(".score");
    const before = Number(scoreNode.textContent);
    firstCard
      .querySelector('.points-row [data-delta="1"]')
      .dispatchEvent(new window.Event("click", { bubbles: true }));
    const freshScore = document.querySelector("#board .card .score");
    expect(Number(freshScore.textContent)).toBe(before + 1);
    const restored = JSON.parse(store.get("contestBoard:current"));
    const scored = restored.groups.map((g) => g.points);
    expect(scored.reduce((a, b) => a + b, 0)).toBe(7 + 1);
  } finally {
    cleanup();
  }
});

it("runner-up uses color names when groups have no explicit name", async () => {
  const { document, window, cleanup } = bootWithSeededState(() => {
    const s = newState();
    setGroupCount(s, 2, () => 0.5);
    addMember(s, s.groups[0].id, "alice", () => 0);
    addMember(s, s.groups[1].id, "bob", () => 0.5);
    startContest(s);
    addPoints(s, s.groups[0].id, 5);
    addPoints(s, s.groups[1].id, 2);
    return s;
  });
  try {
    await appModule();
    document.querySelector("#continue-session").dispatchEvent(new window.Event("click", { bubbles: true }));
    document.querySelector("#end-contest").dispatchEvent(new window.Event("click", { bubbles: true }));
    expect(document.querySelector("#runner-up").textContent).toMatch(/red/);
  } finally {
    cleanup();
  }
});
