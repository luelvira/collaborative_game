"use strict";

import * as lib from "./lib.js";

// Mutable façade so tests can sabotage a single action without rewriting ESM bindings.
export const api = { ...lib };

const CURRENT_KEY = "contestBoard:current";
const $ = (sel) => document.querySelector(sel);
const els = {};

let state;

function persist() {
  if (state) {
    localStorage.setItem(CURRENT_KEY, api.serialize(state));
  }
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

function showView(view) {
  ["#view-home", "#view-setup", "#view-play"].forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    if (sel === view) {
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  });
}

function updateHome() {
  const hasSaved = api.hasSavedSession(localStorage);
  const continueBtn = $("#continue-session");
  if (continueBtn) {
    continueBtn.disabled = !hasSaved;
  }
}

function renderHistory() {
  const runs = api.loadHistory(localStorage);
  const historyEl = $("#history");
  if (!historyEl) return;
  if (runs.length === 0) {
    historyEl.hidden = true;
    return;
  }
  historyEl.hidden = false;
  const list = document.createElement("ul");
  runs
    .slice()
    .reverse()
    .forEach((run) => {
      const li = document.createElement("li");
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = new Date(run.startedAt).toLocaleString();
      const names = (run.winners || [])
        .map((id) => run.groups.find((g) => g.id === id)?.name)
        .filter(Boolean)
        .join(" & ");
      const who = document.createElement("span");
      who.textContent = names ? `Winner: ${names}` : "Winner: -";
      li.append(when, who);
      list.append(li);
    });
  historyEl.replaceChildren(document.createElement("h2"), list);
  const h2 = historyEl.querySelector("h2");
  if (h2) h2.textContent = "Past plays";
}

function renderSetup() {
  const groupCountInput = $("#group-count");
  const setupGroups = $("#setup-groups");
  if (!groupCountInput || !setupGroups) return;

  const n = state.groups.length || Number(groupCountInput.value) || 2;
  if (groupCountInput.value != n && n >= 2 && n <= 6) {
    groupCountInput.value = String(n);
  }

  setupGroups.innerHTML = "";

  if (n === 0 || state.startHue == null) {
    // No groups chosen yet
    return;
  }

  state.groups.forEach((group) => {
    const groupEl = document.createElement("section");
    groupEl.className = "setup-group";
    groupEl.dataset.groupId = group.id;

    const header = document.createElement("header");
    header.className = "setup-group-header";
    const swatch = document.createElement("span");
    swatch.className = "setup-swatch";
    swatch.style.background = api.colorFor(state.startHue, state.groups, group.id);
    const nameInput = document.createElement("input");
    nameInput.className = "setup-group-name";
    nameInput.type = "text";
    nameInput.value = group.name || api.groupName(state.startHue, state.groups, group.id);
    nameInput.maxLength = 30;
    nameInput.addEventListener("change", () => {
      const res = api.renameGroup(state, group.id, nameInput.value);
      if (res && res.error) {
        toast(res.error);
        nameInput.value = group.name || api.groupName(state.startHue, state.groups, group.id);
        return;
      }
      persist();
      renderSetup();
      renderBoard();
    });
    header.append(swatch, nameInput);
    groupEl.append(header);

    const membersWrap = document.createElement("div");
    membersWrap.className = "setup-members";
    const list = document.createElement("ul");
    list.className = "setup-members-list";
    if (group.members.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-hint";
      empty.textContent = "No members yet";
      list.append(empty);
    } else {
      group.members.forEach((m) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.textContent = m;
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "rm";
        rm.textContent = "✕";
        rm.addEventListener("click", () => {
          const res = api.removeMember(state, group.id, m);
          if (res && res.error) {
            toast(res.error);
            return;
          }
          persist();
          renderSetup();
        });
        li.append(span, rm);
        list.append(li);
      });
    }
    membersWrap.append(list);
    groupEl.append(membersWrap);
    setupGroups.append(groupEl);
  });

  updateStartContestButton();
}

function updateStartContestButton() {
  const btn = $("#start-contest");
  if (!btn) return;
  const members = state.groups.reduce((sum, g) => sum + g.members.length, 0);
  if (state.groups.length >= 2 && members >= 1) {
    btn.disabled = false;
  } else {
    btn.disabled = true;
  }
}

function memberRowPlay(name) {
  const li = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = name;
  li.append(label);
  return li;
}

function cardTemplatePlay(group) {
  const card = document.createElement("article");
  card.className = "card card-enter";
  card.dataset.groupId = group.id;
  card.innerHTML = `
    <div class="chip"></div>
    <div class="card-body">
      <div class="card-head">
        <h3></h3>
      </div>
      <div class="score"></div>
      <div class="points-row">
        <button type="button" class="plus" data-action="points" data-delta="1">+1</button>
        <button type="button" class="minus" data-action="points" data-delta="-1">−1</button>
      </div>
      <ul class="members"></ul>
      <span class="empty-hint" hidden>No members yet</span>
    </div>`;
  patchCardPlay(card, group, { isNew: true });
  return card;
}

function patchCardPlay(card, group, { isNew = false } = {}) {
  const color = api.colorFor(state.startHue, state.groups, group.id);
  const chip = card.querySelector(".chip");
  if (chip) chip.style.background = color;
  const h3 = card.querySelector(".card-head h3");
  if (h3) {
    h3.textContent = api.groupName(state.startHue, state.groups, group.id);
  }

  const scoreNode = card.querySelector(".score");
  if (scoreNode) {
    const nextScore = String(group.points);
    if (scoreNode.textContent !== nextScore) {
      scoreNode.textContent = nextScore;
    }
  }

  const membersNode = card.querySelector(".members");
  if (membersNode) {
    const shown = [...membersNode.querySelectorAll("li span")].map((n) => n.textContent);
    if (shown.length !== group.members.length || shown.some((n, i) => n !== group.members[i])) {
      membersNode.replaceChildren(...group.members.map(memberRowPlay));
    }
  }
  const hint = card.querySelector(".empty-hint");
  if (hint) hint.hidden = group.members.length > 0;
  setCardDisabled(card, state.phase === "frozen");
}

function setCardDisabled(card, disabled) {
  card.querySelectorAll("button").forEach((b) => (b.disabled = disabled));
  card.querySelectorAll("input").forEach((i) => (i.disabled = disabled));
}

// Keep existing card nodes; only create/remove/move when the group set or
// layout actually changes, so a score update never re-triggers the enter
// animation (no flash on every board refresh).
function renderBoard() {
  const board = $("#board");
  if (!board) return;
  const rows = board.querySelectorAll(".board-row");
  if (rows.length < 2) return;

  const groups = state.groups || [];
  const firstCount = api.boardRows(groups.length)[0] || 0;

  // Sweep away cards whose group no longer exists.
  const keep = new Set(groups.map((g) => g.id));
  for (const card of board.querySelectorAll(".card")) {
    if (!keep.has(card.dataset.groupId)) card.remove();
  }

  groups.forEach((group, idx) => {
    const inFirstRow = idx < firstCount;
    const row = inFirstRow ? rows[0] : rows[1];
    const slot = inFirstRow ? idx : idx - firstCount;
    let card = board.querySelector(`.card[data-group-id="${group.id}"]`);
    if (!card) {
      card = cardTemplatePlay(group);
    }
    // Re-parent or re-order in place only when the position actually differs;
    // insertBefore with the right neighbour keeps DOM churn at zero for the
    // common case (score updates), so nothing re-animates.
    if (card.parentElement !== row || row.children[slot] !== card) {
      row.insertBefore(card, row.children[slot] || null);
    }
    patchCardPlay(card, group);
  });

  updatePlayChrome();
}

function updatePlayChrome() {
  const status = $("#status-line");
  if (status) {
    const n = state.groups.length;
    const members = state.groups.reduce((sum, g) => sum + g.members.length, 0);
    if (state.phase === "frozen") {
      status.textContent = "Contest ended";
    } else if (state.phase === "playing") {
      status.textContent = `${n} group${n === 1 ? "" : "s"} · ${members} player${members === 1 ? "" : "s"}`;
    } else {
      status.textContent = "Live";
    }
  }
  const endBtn = $("#end-contest");
  if (endBtn) {
    endBtn.disabled = state.phase !== "playing" || state.groups.length === 0;
  }
}

function renderWinner() {
  const winnerEl = $("#winner");
  const winnerIds = api.winners(state);
  const winnerName = $("#winner-name");
  const winnerMembers = $("#winner-members");
  const runnerUp = $("#runner-up");
  if (!winnerEl) return;
  if (state.phase !== "frozen") {
    winnerEl.hidden = true;
    return;
  }
  const names = winnerIds
    .map((id) => api.groupName(state.startHue, state.groups, id))
    .filter(Boolean);
  if (winnerName) winnerName.textContent = names.join(" & ") || "Tie";
  if (winnerMembers) {
    winnerMembers.innerHTML = "";
    state.groups
      .filter((g) => winnerIds.includes(g.id))
      .forEach((g) => {
        (g.members || []).forEach((name) => {
          const li = document.createElement("li");
          li.textContent = name;
          winnerMembers.appendChild(li);
        });
      });
  }
  if (runnerUp) {
    const rest = state.groups
      .filter((g) => !winnerIds.includes(g.id))
      .map((g) => `${api.groupName(state.startHue, state.groups, g.id)} (${g.points})`)
      .join(", ");
    runnerUp.textContent = rest ? `Runner-up: ${rest}` : "";
  }
  winnerEl.hidden = false;
}

function wireHome() {
  const cont = $("#continue-session");
  const fresh = $("#fresh-session");
  if (cont) {
    cont.addEventListener("click", () => {
      const raw = localStorage.getItem(CURRENT_KEY);
      if (!raw) {
        toast("Nothing saved to continue");
        updateHome();
        return;
      }
      try {
        state = api.deserialize(raw);
        if (!state || !Array.isArray(state.groups)) throw new Error("bad");
      } catch (e) {
        toast("Could not load saved session");
        return;
      }
      persist();
      // Go to appropriate view based on phase
      if (state.phase === "playing") {
        showView("#view-play");
        renderBoard();
        renderWinner();
      } else if (state.phase === "frozen") {
        showView("#view-play");
        renderBoard();
        renderWinner();
      } else {
        showView("#view-setup");
        renderSetup();
      }
      renderHistory();
    });
  }
  if (fresh) {
    fresh.addEventListener("click", () => {
      state = api.newState();
      persist();
      showView("#view-setup");
      const gc = $("#group-count");
      if (gc) gc.value = "2";
      renderSetup();
      renderHistory();
    });
  }
}

// Wrap an event handler so an unexpected exception becomes a visible toast
// instead of a silently dead control.
function on(handler, label) {
  return (event) => {
    try {
      return handler(event);
    } catch (e) {
      return toast((label ? label + ": " : "") + (e && e.message ? e.message : e));
    }
  };
}

function wireSetup() {
  const gc = $("#group-count");
  if (gc) {
    gc.addEventListener(
      "change",
      on(() => {
        const n = Number(gc.value);
        const res = api.setGroupCount(state, n);
        if (res && res.error) {
          toast(res.error);
          gc.value = String(state.groups.length || 2);
          return;
        }
        persist();
        renderSetup();
      }, "Groups"),
    );
  }
  const addUser = $("#add-user");
  const userName = $("#user-name");
  const addNamedUser = () => {
    if (!userName) return;
    const name = userName.value.trim();
    if (!name) return toast("Type a name for the user");
    if (!state.groups || state.groups.length === 0) return toast("Create groups first");
    const anchor = state.groups[0];
    const res = api.addMember(state, anchor.id, name);
    if (res && res.error) {
      toast(res.error);
      return;
    }
    userName.value = "";
    persist();
    renderSetup();
  };
  if (addUser) addUser.addEventListener("click", on(addNamedUser, "Add user"));
  if (userName) {
    userName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addNamedUser();
      }
    });
  }
  const start = $("#start-contest");
  if (start) {
    start.addEventListener(
      "click",
      on(() => {
        const res = api.startContest(state);
        if (res && res.error) {
          toast(res.error);
          return;
        }
        persist();
        showView("#view-play");
        renderBoard();
        renderWinner();
      }, "Start contest"),
    );
  }
  const setupHome = $("#setup-home");
  if (setupHome) {
    setupHome.addEventListener(
      "click",
      on(() => {
        showView("#view-home");
        updateHome();
        renderHistory();
      }, "Home"),
    );
  }
}

function wirePlay() {
  const board = $("#board");
  if (board) {
    board.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || !board.contains(target)) return;
      const card = target.closest(".card");
      if (!card) return;
      const groupId = card.dataset.groupId;
      const action = target.dataset.action;
      if (action === "points") {
        const delta = Number(target.dataset.delta);
        const res = api.addPoints(state, groupId, delta);
        if (res && res.error) {
          toast(res.error);
          return;
        }
        persist();
        renderBoard();
        return;
      }
    });
  }
  const end = $("#end-contest");
  if (end) {
    end.addEventListener("click", () => {
      const res = api.endContest(state);
      if (res && res.error) {
        toast(res.error);
        return;
      }
      persist();
      renderBoard();
      renderWinner();
    });
  }
}

function wireOverlay() {
  const reset = $("#reset");
  if (reset) {
    reset.addEventListener("click", () => {
      if (!window.confirm("Archive this play and start a new contest?")) return;
      const runs = api.loadHistory(localStorage);
      runs.push(api.archiveRun(state));
      api.saveHistory(localStorage, runs);
      state = api.newState();
      persist();
      const winnerEl = $("#winner");
      if (winnerEl) winnerEl.hidden = true;
      showView("#view-home");
      updateHome();
      renderHistory();
    });
  }
}

function boot() {
  [
    ["board", "#board"],
    ["endContest", "#end-contest"],
    ["history", "#history"],
    ["winner", "#winner"],
    ["winnerName", "#winner-name"],
    ["winnerMembers", "#winner-members"],
    ["runnerUp", "#runner-up"],
    ["reset", "#reset"],
    ["status", "#status-line"],
  ].forEach(([key, sel]) => {
    const el = $(sel);
    if (el) els[key] = el;
  });

  // Always start at home
  showView("#view-home");
  updateHome();
  renderHistory();

  wireHome();
  wireSetup();
  wirePlay();
  wireOverlay();

  // Expose for tests
  window.__contestApi = api;
}

boot();
