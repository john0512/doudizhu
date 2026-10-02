const app = document.getElementById("app");
const TOKEN_KEY = "doudizhu.token";

let token = localStorage.getItem(TOKEN_KEY);
let user = null;
let ws = null;
let wsGen = 0;
let view = "boot";
let error = "";
let room = null;
let game = null;
let selected = new Set();
let queueCount = 0;
let queueRoom = "";
let toast = "";
let lobbyTab = "play";
let stats = { registered: 0, online: 0 };
let statsTimer = null;
let board = [];
let boardLoaded = false;

function statsLine() {
  return `<p class="stats" id="stats">${stats.registered} registered · ${stats.online} online</p>`;
}

function applyStats(next) {
  if (!next || next.registered == null) return;
  stats = { registered: next.registered, online: next.online };
  const el = document.getElementById("stats");
  if (el) el.outerHTML = statsLine();
}

async function refreshStats() {
  try {
    const data = await api("/api/stats");
    applyStats(data);
  } catch {
    /* ignore */
  }
}

function startStatsPoll() {
  if (statsTimer) return;
  refreshStats();
  statsTimer = setInterval(refreshStats, 8000);
}

function stopStatsPoll() {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = null;
}

const CREDITS = `<p class="credits">Developed with help from Cursor<br>Rank system inspired by Tenhou</p>`;
const RANK_DAN = {
  peasant: 0,
  dan1: 1,
  dan2: 2,
  dan3: 3,
  dan4: 4,
  dan5: 5,
  dan6: 6,
  dan7: 7,
  dan8: 8,
  dan9: 9,
  landlord: 10,
};
const ROOMS = [
  { id: "farm", name: "Farm", range: "Peasant – 4 Dan", orbits: 1, first: 5, minDan: 0, maxDan: 4 },
  { id: "plantation", name: "Plantation", range: "3 Dan – 6 Dan", orbits: 2, first: 8, minDan: 3, maxDan: 6 },
  { id: "apartment", name: "Apartment", range: "5 Dan – 8 Dan", orbits: 3, first: 11, minDan: 5, maxDan: 8 },
  { id: "city", name: "City", range: "7 Dan and above", orbits: 3, first: 14, minDan: 7, maxDan: 10 },
];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadBoard() {
  try {
    const data = await api("/api/leaderboard");
    board = data.players || [];
  } catch {
    board = [];
  }
  boardLoaded = true;
  if (view === "lobby" && lobbyTab === "board") render();
}

function setError(msg) {
  error = msg || "";
  render();
}

function showToast(msg) {
  toast = msg;
  render();
  setTimeout(() => {
    if (toast === msg) {
      toast = "";
      render();
    }
  }, 2400);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.message || "Request failed");
  return data;
}

let retryMs = 1000;

function connect() {
  stopStatsPoll();
  wsGen += 1;
  const gen = wsGen;
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onopen = () => {
    retryMs = 1000;
  };
  ws.onmessage = (ev) => {
    if (gen !== wsGen) return;
    const msg = JSON.parse(ev.data);
    if (msg.type === "error") {
      showToast(msg.message);
      return;
    }
    if (msg.type === "info") {
      showToast(msg.message);
      return;
    }
    if (msg.type === "stats") {
      applyStats(msg);
      return;
    }
    if (msg.type === "lobby") {
      user = msg.user;
      applyStats(msg);
      view = "lobby";
      room = null;
      game = null;
      selected.clear();
      render();
      return;
    }
    if (msg.type === "queued") {
      if (view === "table" && game) return;
      view = "queue";
      queueCount = msg.waiting;
      queueRoom = msg.room;
      render();
      return;
    }
    if (msg.type === "room") {
      view = "room";
      room = msg;
      render();
      return;
    }
    if (msg.type === "game") {
      const state = msg.state || msg;
      if (!state || !Array.isArray(state.players)) return;
      view = "table";
      game = state;
      const mine = game.players[game.viewerSeat];
      if (mine && mine.hand) {
        const live = new Set(mine.hand.map((c) => c.id));
        selected = new Set([...selected].filter((id) => live.has(id)));
      } else {
        selected.clear();
      }
      try {
        render();
      } catch (err) {
        console.error(err);
        showToast(err.message || "Could not show the table");
      }
    }
  };
  ws.onclose = () => {
    if (gen !== wsGen) return;
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, 8000);
    if (view !== "auth") showToast("Disconnected — retrying");
    setTimeout(() => {
      if (gen === wsGen && token && view !== "auth") connect();
    }, wait);
  };
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return;
  }
  if (ws && ws.readyState === WebSocket.CONNECTING) return;
  if (token && view !== "auth") connect();
}

const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" };

function cardClass(card, size) {
  const red = card.suit === "H" || card.suit === "D" || card.rank === "RJ";
  return `card ${size || ""} ${red ? "red" : ""} ${card.rank === "BJ" || card.rank === "RJ" ? "joker" : ""}`;
}

function renderCard(card, opts = {}) {
  if (card.hidden) return `<div class="card ${opts.size || ""} back"></div>`;
  const suit = card.suit ? SUIT[card.suit] : card.rank === "RJ" ? "★" : "☆";
  const rank = card.rank === "BJ" ? "Joker" : card.rank === "RJ" ? "Joker" : card.rank;
  const selectedCls = selected.has(card.id) ? "selected" : "";
  const click = opts.clickable ? `data-id="${card.id}"` : "";
  return `<div class="${cardClass(card, opts.size)} ${selectedCls}" ${click}>
    <div class="rank">${rank}</div>
    <div class="suit">${suit}</div>
    <div class="suit-lg">${suit}</div>
  </div>`;
}

function renderAuth() {
  app.innerHTML = `
    <div class="panel">
      <div class="brand">
        <h1>斗地主</h1>
        <p>Fight the Landlord · 3 players</p>
      </div>
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <div class="row">
        <button class="primary" id="login">Log in</button>
        <button class="ghost" id="register">Create account</button>
      </div>
      <div class="error">${error}</div>
      ${statsLine()}
      ${CREDITS}
    </div>
    ${toast ? `<div class="toast">${toast}</div>` : ""}`;
  const creds = () => ({
    username: document.getElementById("username").value.trim(),
    password: document.getElementById("password").value,
  });
  document.getElementById("login").onclick = async () => {
    try {
      const data = await api("/api/login", creds());
      token = data.token;
      user = data.user;
      localStorage.setItem(TOKEN_KEY, token);
      error = "";
      connect();
    } catch (e) {
      setError(e.message);
    }
  };
  document.getElementById("register").onclick = async () => {
    try {
      const data = await api("/api/register", creds());
      token = data.token;
      user = data.user;
      localStorage.setItem(TOKEN_KEY, token);
      error = "";
      connect();
    } catch (e) {
      setError(e.message);
    }
  };
  startStatsPoll();
}

function renderLobby() {
  const dan = RANK_DAN[user.rank] ?? 0;
  const openRooms = ROOMS.filter((r) => dan >= r.minDan && dan <= r.maxDan);
  const rooms = openRooms
    .map(
      (r) => `
      <div class="mode-card">
        <h2>${r.name}</h2>
        <p>${r.orbits} orbit${r.orbits === 1 ? "" : "s"} (${r.orbits * 3} hands)</p>
        <button class="primary" data-room="${r.id}">Join ${r.name}</button>
      </div>`,
    )
    .join("");
  const playBody = `
    <div class="modes rooms">${rooms}
      <div class="mode-card friendly">
        <h2>Friendly room</h2>
        <p>Choose match length, then share a code.</p>
        <div class="length-row" id="friendly-len">
          ${[1, 3, 6, 9].map((n) => `<button type="button" class="ghost ${n === 1 ? "on" : ""}" data-hands="${n}">${n} hand${n === 1 ? "" : "s"}</button>`).join("")}
        </div>
        <button class="primary" id="create">Create room</button>
        <div class="code-row">
          <input id="code" placeholder="Room code" maxlength="6" />
          <button class="ghost" id="join">Join</button>
        </div>
      </div>
    </div>`;
  const ranksBody = `
    <article class="rules">
      <h2>Ranks</h2>
      <p>Each rank has a starting amount (half of the promotion line) and a promotion threshold. Reach the threshold to promote into the next rank at its starting points. Reach negative points to drop to the previous rank at its starting points. Extra points past the threshold or below 0 are discarded. Landlord has no promotion cap.</p>
      <table>
        <thead><tr><th>Rank</th><th>Start</th><th>Promote at</th><th>3rd place penalty</th></tr></thead>
        <tbody>
          <tr><td>Peasant</td><td>0</td><td>10</td><td>0</td></tr>
          <tr><td>1 Dan</td><td>10</td><td>20</td><td>2</td></tr>
          <tr><td>2 Dan</td><td>20</td><td>40</td><td>4</td></tr>
          <tr><td>3 Dan</td><td>30</td><td>60</td><td>6</td></tr>
          <tr><td>4 Dan</td><td>40</td><td>80</td><td>8</td></tr>
          <tr><td>5 Dan</td><td>50</td><td>100</td><td>10</td></tr>
          <tr><td>6 Dan</td><td>70</td><td>140</td><td>12</td></tr>
          <tr><td>7 Dan</td><td>100</td><td>200</td><td>14</td></tr>
          <tr><td>8 Dan</td><td>150</td><td>300</td><td>16</td></tr>
          <tr><td>9 Dan</td><td>200</td><td>400</td><td>18</td></tr>
          <tr><td>Landlord</td><td>200</td><td>No cap</td><td>18 + ⌊points / 200⌋</td></tr>
        </tbody>
      </table>
      <h2>Matches</h2>
      <p>An orbit is 3 hands. The first bidder rotates through each seat once per orbit. Seats are shuffled at the start of the match. Hand scores (bid, bombs/rockets, spring) only decide 1st, 2nd, and 3rd. Ties go to whoever sat in the earlier first-bidder seat.</p>
      <h2>Rooms</h2>
      <table>
        <thead><tr><th>Room</th><th>Who can play</th><th>Length</th><th>1st place</th></tr></thead>
        <tbody>
          <tr><td>Farm</td><td>Peasant – 4 Dan</td><td>1 orbit (3 hands)</td><td>+5</td></tr>
          <tr><td>Plantation</td><td>3 Dan – 6 Dan</td><td>2 orbits (6 hands)</td><td>+8</td></tr>
          <tr><td>Apartment</td><td>5 Dan – 8 Dan</td><td>3 orbits (9 hands)</td><td>+11</td></tr>
          <tr><td>City</td><td>7 Dan and above</td><td>3 orbits (9 hands)</td><td>+14</td></tr>
        </tbody>
      </table>
      <h2>Rank points</h2>
      <p>Awarded from placement at the end of the match, not from hand scores.</p>
      <ul>
        <li><strong>1st:</strong> the room bonus above</li>
        <li><strong>2nd:</strong> no change</li>
        <li><strong>3rd:</strong> Loss based on above table</li>
      </ul>
    </article>`;
  const boardRows = board
    .map((row) => {
      const you = user && (row.id === user.id || row.username === user.username);
      return `<tr class="${you ? "you" : ""}"><td>${row.place}</td><td>${esc(row.username)}${you ? " <span class=\"you-tag\">you</span>" : ""}</td><td>${esc(row.rankLabel || row.rank)}</td><td>${row.rankPoints ?? 0}</td></tr>`;
    })
    .join("");
  const boardBody = `
    <article class="rules">
      <h2>Leaderboard</h2>
      <p>Top 20 accounts, ranked by dan then by points inside that rank.</p>
      ${
        !boardLoaded
          ? "<p>Loading…</p>"
          : board.length
            ? `<table>
        <thead><tr><th>#</th><th>Player</th><th>Rank</th><th>Points</th></tr></thead>
        <tbody>${boardRows}</tbody>
      </table>`
            : "<p>No accounts yet.</p>"
      }
    </article>`;
  app.innerHTML = `
    <div class="lobby-head">
      <div class="who">Signed in as <strong>${user.username}</strong> · ${user.rankLabel || "Peasant 0/10"}</div>
      <div class="head-right">${statsLine()}<button class="ghost" id="logout">Log out</button></div>
    </div>
    <div class="tabs" role="tablist">
      <button class="${lobbyTab === "play" ? "tab on" : "tab"}" data-tab="play">Play</button>
      <button class="${lobbyTab === "board" ? "tab on" : "tab"}" data-tab="board">Leaderboard</button>
      <button class="${lobbyTab === "ranks" ? "tab on" : "tab"}" data-tab="ranks">Ranking</button>
    </div>
    ${lobbyTab === "ranks" ? ranksBody : lobbyTab === "board" ? boardBody : playBody}
    ${CREDITS}
    ${toast ? `<div class="toast">${toast}</div>` : ""}`;
  document.getElementById("logout").onclick = () => {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    if (ws) ws.close();
    view = "auth";
    render();
  };
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.onclick = () => {
      lobbyTab = el.dataset.tab;
      if (lobbyTab === "board") boardLoaded = false;
      render();
      if (lobbyTab === "board") loadBoard();
    };
  });
  document.querySelectorAll("[data-room]").forEach((el) => {
    el.onclick = () => send({ type: "queue", room: el.dataset.room });
  });
  const create = document.getElementById("create");
  if (create) {
    let friendlyHands = 1;
    document.querySelectorAll("[data-hands]").forEach((el) => {
      el.onclick = () => {
        friendlyHands = Number(el.dataset.hands);
        document.querySelectorAll("[data-hands]").forEach((b) => b.classList.toggle("on", b === el));
      };
    });
    create.onclick = () => send({ type: "create_room", hands: friendlyHands });
  }
  const join = document.getElementById("join");
  if (join) join.onclick = () => send({ type: "join_room", code: document.getElementById("code").value });
}

function renderQueue() {
  const room = ROOMS.find((r) => r.id === queueRoom);
  app.innerHTML = `
    <div class="waiting">
      <h2>Searching ${room ? room.name : "rated"}…</h2>
      <p>${queueCount} / 3 in queue</p>
      ${queueCount >= 3 ? "<p>Starting match…</p>" : ""}
      <button class="ghost" id="cancel">Cancel</button>
    </div>
    ${CREDITS}
    ${toast ? `<div class="toast">${toast}</div>` : ""}`;
  document.getElementById("cancel").onclick = () => send({ type: "leave_queue" });
}

function renderRoom() {
  const seats = room.players.map((p) => `${p.username} (${p.rankLabel || p.rating || ""})`).join("<br>");
  app.innerHTML = `
    <div class="waiting">
      <p>Friendly room · ${room.hands || 1} hand${(room.hands || 1) === 1 ? "" : "s"}</p>
      <div class="code">${room.code}</div>
      <p>${room.players.length} / 3 players</p>
      <p>${seats}</p>
      <p>Share the code. The match starts when the third player joins.</p>
      <button class="ghost" id="leave">Leave room</button>
    </div>
    ${CREDITS}
    ${toast ? `<div class="toast">${toast}</div>` : ""}`;
  document.getElementById("leave").onclick = () => send({ type: "leave_room" });
}

function seatMeta(p) {
  const landlord = p.isLandlord ? `<span class="badge">地主</span>` : "";
  const first = game.firstBidder === p.seat ? `<span class="badge ghost-badge">1st bid</span>` : "";
  return `<div class="seat ${game.turn === p.seat && game.phase !== "over" ? "turn-glow" : ""}">
    <div class="name">${p.username}${landlord}${first}</div>
    <div class="meta">${p.rankLabel || ""} · ${p.matchScore ?? 0} pts · ${p.cardCount} cards${p.connected ? "" : " · away"}</div>
  </div>`;
}

function renderTable() {
  const me = game && Array.isArray(game.players) ? game.players[game.viewerSeat] || game.players[0] : null;
  if (!me) {
    view = "lobby";
    return renderLobby();
  }
  const others = game.players.filter((p) => p.seat !== me.seat);
  const myTurn = game.turn === me.seat && game.phase !== "over";
  const actor = game.players[game.turn];
  const turnHint =
    game.phase === "over"
      ? ""
      : myTurn
        ? game.phase === "bid"
          ? "Your bid"
          : game.lastCombo && game.lastPlayer !== me.seat
            ? "Beat the last play or pass"
            : "Lead a combo"
        : `Waiting for ${actor ? actor.username : "the next player"}`;
  const bottom = (game.bottom || []).map((c) => renderCard(c, { size: "small" })).join("");
  const pile = game.lastCombo
    ? game.lastCombo.cards.map((c) => renderCard(c)).join("")
    : `<span style="opacity:.7">${game.phase === "bid" ? "Bidding for landlord" : "Lead any legal combo"}</span>`;
  const bidButtons =
    game.phase === "bid" && myTurn
      ? `<button class="ghost" data-bid="0">Pass</button>
         ${[1, 2, 3]
           .filter((v) => v > game.highestBid)
           .map((v) => `<button class="primary" data-bid="${v}">Call ${v}</button>`)
           .join("")}`
      : "";
  const playButtons =
    game.phase === "play" && myTurn
      ? `<button class="primary" id="play">Play</button>
         <button class="ghost" id="pass">Pass</button>`
      : "";
  const deltas = game.scoreDeltas || [0, 0, 0];
  const multipliers = [`bid ${game.highestBid || 1}`];
  if (game.bombCount) multipliers.push(`×${2 ** game.bombCount} (${game.bombCount} bomb${game.bombCount === 1 ? "" : "s"}/rocket${game.bombCount === 1 ? "" : "s"})`);
  if (game.spring) multipliers.push("×2 spring");
  const match = game.match || {};
  const complete = Boolean(match.complete);
  const placement = (match.placement || [])
    .sort((a, b) => a.place - b.place)
    .map((row) => {
      const before = row.beforeRank
        ? `${row.username}: ${placeWord(row.place)} · ${fmtDelta(row.delta)} rank → ${fmtResult(row)}`
        : `${row.username}: ${placeWord(row.place)} · ${row.delta ? fmtDelta(row.delta) : "match points only"}`;
      return before;
    })
    .join("<br>");
  const over =
    game.phase === "over"
      ? `<div class="overlay"><div class="panel">
          <h2>${game.landlordWon ? "Landlord wins" : "Peasants win"} this hand</h2>
          <p class="score-line">${multipliers.join(" ")} = ${game.baseScore ?? ""}</p>
          <p>${game.players
            .map((p) => `${p.username}: ${fmtDelta(deltas[p.seat])} (match ${p.matchScore ?? 0})`)
            .join("<br>")}</p>
          ${
            complete
              ? `<h2>Match over</h2><p>${placement}</p>
                 <p>${match.rated ? "Rank points updated" : "Friendly — ranks unchanged"}</p>
                 <button class="primary" id="home">Back to lobby</button>`
              : `<p>Hand ${match.hand || 1} / ${match.totalHands || 1}${match.orbits ? ` · orbit ${match.orbit}/${match.orbits}` : ""}</p>
                 <p>${(match.ready || []).filter(Boolean).length} ready</p>
                 <button class="primary" id="next">Next hand</button>`
          }
        </div></div>`
      : "";

  app.innerHTML = `
    <div class="table">
      <div class="top-bar">
        <div>${match.roomName || (game.mode === "rated" ? "Rated" : "Friendly")}${
          match.rated
            ? ` · orbit ${match.orbit}/${match.orbits} · hand ${match.hand}/${match.totalHands}`
            : match.totalHands > 1
              ? ` · hand ${match.hand}/${match.totalHands}`
              : ""
        } · bid ${game.highestBid || "—"} · bombs ${game.bombCount}</div>
        <div class="bottom-cards">${bottom}</div>
      </div>
      <div>
        <div class="opponents">${others.map(seatMeta).join("")}</div>
        <div class="pile">${pile}</div>
        <div class="turn-hint">${turnHint}</div>
      </div>
      <div class="me">
        ${seatMeta(me)}
        <div class="hand" id="hand">${(me.hand || []).map((c) => renderCard(c, { clickable: true })).join("")}</div>
        <div class="actions">${bidButtons}${playButtons}</div>
      </div>
    </div>
    ${over}
    ${toast ? `<div class="toast">${toast}</div>` : ""}`;

  document.querySelectorAll(".hand .card[data-id]").forEach((el) => {
    el.onclick = () => {
      const id = Number(el.dataset.id);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      render();
    };
  });
  document.querySelectorAll("[data-bid]").forEach((el) => {
    el.onclick = () => send({ type: "bid", value: Number(el.dataset.bid) });
  });
  const playBtn = document.getElementById("play");
  if (playBtn) playBtn.onclick = () => send({ type: "play", cards: [...selected] });
  const passBtn = document.getElementById("pass");
  if (passBtn) passBtn.onclick = () => send({ type: "pass" });
  const home = document.getElementById("home");
  if (home) home.onclick = () => send({ type: "lobby" });
  const next = document.getElementById("next");
  if (next) next.onclick = () => send({ type: "next_hand" });
}

function fmtDelta(n) {
  if (n > 0) return `+${n}`;
  return String(n ?? 0);
}

function placeWord(n) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : "3rd";
}

function fmtResult(row) {
  if (!row.rank) return "";
  const names = {
    peasant: "Peasant",
    dan1: "1 Dan",
    dan2: "2 Dan",
    dan3: "3 Dan",
    dan4: "4 Dan",
    dan5: "5 Dan",
    dan6: "6 Dan",
    dan7: "7 Dan",
    dan8: "8 Dan",
    dan9: "9 Dan",
    landlord: "Landlord",
  };
  const name = names[row.rank] || row.rank;
  const cap = { peasant: 10, dan1: 20, dan2: 40, dan3: 60, dan4: 80, dan5: 100, dan6: 140, dan7: 200, dan8: 300, dan9: 400 }[row.rank];
  return cap == null ? `${name} ${row.rankPoints}` : `${name} ${row.rankPoints}/${cap}`;
}

function render() {
  if (view === "auth" || view === "boot") return renderAuth();
  if (view === "lobby") return renderLobby();
  if (view === "queue") return renderQueue();
  if (view === "room") return renderRoom();
  if (view === "table") return renderTable();
}

async function boot() {
  refreshStats();
  if (!token) {
    view = "auth";
    render();
    return;
  }
  try {
    const data = await api("/api/me");
    user = data.user;
    view = "lobby";
    render();
    connect();
  } catch {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    view = "auth";
    render();
  }
}

boot();
