import {
  newState,
  addGroup,
  removeGroup,
  addMember,
  removeMember,
  addPoints,
  colorFor,
  serialize,
  deserialize,
  loadHistory,
} from "./lib.js";

const CURRENT_KEY = "contestBoard:current";
const $ = (sel) => document.querySelector(sel);
const els = {};

let state;

function persist() {
  localStorage.setItem(CURRENT_KEY, serialize(state));
}

let toastTimer;
function toast(message) {
  let node = $("#toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "toast";
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}

function boot() {
  [
    ["board", "#board"],
    ["groupName", "#group-name"],
    ["addGroup", "#add-group"],
    ["userName", "#user-name"],
    ["addUser", "#add-user"],
    ["endContest", "#end-contest"],
    ["history", "#history"],
  ].forEach(([key, sel]) => (els[key] = $(sel)));

  const raw = localStorage.getItem(CURRENT_KEY);
  if (raw) {
    try {
      state = deserialize(raw);
    } catch {
      state = null;
    }
  }
  if (!state || !state.groups) {
    state = newState();
    persist();
  }
  renderBoard();
  renderHistory();
  wireTopBar();
}

function cardTemplate(group, color) {
  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <div class="chip" style="background:${color}"></div>
    <div class="card-body">
      <div class="card-head">
        <h3></h3>
        <button class="rm-group" type="button" title="Remove group (only when empty)">✕</button>
      </div>
      <div class="score"></div>
      <div class="points-row">
        <button type="button" class="plus" data-delta="5">+5</button>
        <button type="button" class="plus" data-delta="1">+1</button>
        <button type="button" class="minus" data-delta="-1">−1</button>
        <button type="button" class="minus" data-delta="-5">−5</button>
      </div>
      <div class="custom-points">
        <input type="number" step="any" placeholder="custom pts">
        <button type="button">Add</button>
      </div>
      <ul class="members"></ul>
      <span class="empty-hint" hidden>No members yet</span>
    </div>`;
  card.querySelector(".card-head h3").textContent = group.name;
  const scoreNode = card.querySelector(".score");

  const render = () => {
    scoreNode.textContent = group.points;
    const membersNode = card.querySelector(".members");
    membersNode.replaceChildren();
    group.members.forEach((name) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = name;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "rm";
      rm.textContent = "✕";
      rm.title = "Remove member";
      rm.addEventListener("click", () => act(() => removeMember(state, group.id, name)));
      li.append(label, rm);
      membersNode.append(li);
    });
    card.querySelector(".empty-hint").hidden = group.members.length > 0;
  };

  card.querySelector(".rm-group").addEventListener("click", () =>
    act(() => removeGroup(state, group.id)),
  );
  card.querySelectorAll(".points-row [data-delta]").forEach((btn) =>
    btn.addEventListener("click", () =>
      act(() => addPoints(state, group.id, Number(btn.dataset.delta))),
    ),
  );
  const customInput = card.querySelector(".custom-points input");
  const customBtn = card.querySelector(".custom-points button");
  const applyCustom = () => act(() => addPoints(state, group.id, Number(customInput.value)));
  customBtn.addEventListener("click", applyCustom);
  customInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyCustom();
  });

  render();
  return card;
}

function renderBoard() {
  els.board.replaceChildren();
  state.groups.forEach((group) => {
    const color = colorFor(state.startHue, state.groups, group.id);
    els.board.append(cardTemplate(group, color));
  });
  els.endContest.disabled = state.groups.length === 0;
}

function renderHistory() {
  const runs = loadHistory(localStorage);
  if (runs.length === 0) {
    els.history.hidden = true;
    return;
  }
  els.history.hidden = false;
  const list = document.createElement("ul");
  runs.forEach((run) => {
    const li = document.createElement("li");
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = new Date(run.startedAt).toLocaleString();
    const names = run.winners
      .map((id) => run.groups.find((g) => g.id === id)?.name)
      .filter(Boolean)
      .join(" & ");
    const who = document.createElement("span");
    who.textContent = `Winner: ${names}`;
    li.append(when, who);
    list.append(li);
  });
  els.history.replaceChildren(document.createElement("h2"), list);
  els.history.querySelector("h2").textContent = "Past plays";
}

// Runs a lib action; on error shows feedback, on success persists + re-renders.
function act(action) {
  const result = action();
  if (result && result.error) {
    toast(result.error);
    return;
  }
  persist();
  renderBoard();
}

function wireTopBar() {
  const addNamedGroup = () => {
    const name = els.groupName.value.trim();
    if (!name) return toast("Group needs a name");
    act(() => addGroup(state, name));
    els.groupName.value = "";
  };
  els.addGroup.addEventListener("click", addNamedGroup);
  els.groupName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addNamedGroup();
  });

  const addNamedUser = () => {
    const name = els.userName.value.trim();
    if (!name) return toast("Type a name for the user");
    const anchor = state.groups[0];
    if (!anchor) return toast("Create a group first");
    act(() => addMember(state, anchor.id, name));
    els.userName.value = "";
  };
  els.addUser.addEventListener("click", addNamedUser);
  els.userName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addNamedUser();
  });
}

boot();
