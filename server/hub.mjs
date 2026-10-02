import { AllPass } from "./engine.mjs";
import { Match } from "./match.mjs";
import * as db from "./db.mjs";
import { ROOMS, canJoinRoom, joinError } from "./ranks.mjs";

export class Hub {
  constructor() {
    this.sockets = new Map();
    this.queues = { farm: [], plantation: [], apartment: [], city: [] };
    this.rooms = new Map();
    this.userRoom = new Map();
    this.userMatch = new Map();
    this.matches = new Map();
    this.flushTimer = setInterval(() => this.flushQueues(), 400);
  }

  uid(id) {
    return db.normId(id);
  }

  connect(user, send, closer) {
    const id = this.uid(user.id);
    const list = this.sockets.get(id) || [];
    this.sockets.set(id, [...list.filter((s) => s.closer !== closer), { send, closer }]);
    this.flushQueues();
    const match = this.matchFor(id);
    if (match) {
      match.setConnected(id, true);
      this.broadcastMatch(match);
    } else if (this.inQueue(id)) {
      this.notifyQueue(this.queueIdFor(id));
    } else {
      this.sendLobby(id);
    }
    this.broadcastStats();
  }

  disconnect(userId, closer) {
    const id = this.uid(userId);
    const list = (this.sockets.get(id) || []).filter((s) => s.closer !== closer);
    if (list.length) this.sockets.set(id, list);
    else this.sockets.delete(id);
    if (this.sockets.has(id)) return;
    const match = this.matchFor(id);
    if (match) {
      match.setConnected(id, false);
      this.broadcastMatch(match);
      if (match.game.phase === "over" && !match.complete && match.allReady()) {
        this.advanceHand(match);
      }
    }
    this.broadcastStats();
    this.flushQueues();
  }

  queueRoom(user, roomId) {
    const id = this.uid(user.id);
    const fresh = db.getUser(id);
    if (this.userMatch.has(id)) return this.send(id, { type: "error", message: "Already in a match" });
    if (this.userRoom.has(id)) return this.send(id, { type: "error", message: "Leave your room first" });
    if (!ROOMS[roomId]) return this.send(id, { type: "error", message: "Unknown room" });
    if (!canJoinRoom(roomId, fresh.rank)) {
      return this.send(id, { type: "error", message: joinError(roomId, fresh.rank) });
    }
    for (const key of Object.keys(this.queues)) {
      this.queues[key] = this.queues[key].filter((uid) => this.uid(uid) !== id);
    }
    this.queues[roomId].push(id);
    this.flushQueues();
    if (this.inQueue(id)) this.notifyQueue(roomId);
  }

  leaveQueue(userId) {
    const id = this.uid(userId);
    for (const key of Object.keys(this.queues)) {
      this.queues[key] = this.queues[key].filter((uid) => this.uid(uid) !== id);
      this.notifyQueue(key);
    }
    const match = this.matchFor(id);
    if (match && !match.complete && this.matchStillSeating(match)) {
      this.cancelMatch(match);
      return;
    }
    if (match) {
      this.dropUserMatch(id);
      try {
        match.setConnected(id, false);
        this.broadcastMatch(match);
      } catch {
        /* already dropped */
      }
    }
    this.sendLobby(id);
  }

  inQueue(userId) {
    const id = this.uid(userId);
    return Object.values(this.queues).some((q) => q.some((uid) => this.uid(uid) === id));
  }

  queueIdFor(userId) {
    const id = this.uid(userId);
    return Object.keys(this.queues).find((roomId) => this.queues[roomId].some((uid) => this.uid(uid) === id));
  }

  uniqueConnected(ids) {
    const seen = new Set();
    const out = [];
    for (const raw of ids) {
      const id = this.uid(raw);
      if (seen.has(id) || this.userMatch.has(id) || !this.sockets.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  flushQueues() {
    for (const roomId of Object.keys(this.queues)) {
      const before = this.queues[roomId].length;
      this.queues[roomId] = this.uniqueConnected(this.queues[roomId]);
      let launched = false;
      while (this.queues[roomId].length >= 3) {
        const ids = this.queues[roomId].slice(0, 3);
        if (!this.startMatch(roomId, ids)) break;
        launched = true;
        const started = new Set(ids);
        this.queues[roomId] = this.queues[roomId].filter((uid) => !started.has(this.uid(uid)));
      }
      if (launched || this.queues[roomId].length !== before) this.notifyQueue(roomId);
    }
  }

  createRoom(user, rawHands) {
    if (this.userMatch.has(user.id) || this.inQueue(user.id)) {
      return this.send(user.id, { type: "error", message: "Finish matchmaking first" });
    }
    if (this.userRoom.has(user.id)) return this.roomSnapshot(this.rooms.get(this.userRoom.get(user.id)));
    const hands = [1, 3, 6, 9].includes(Number(rawHands)) ? Number(rawHands) : 1;
    let code = db.roomCode();
    while (this.rooms.has(code)) code = db.roomCode();
    const room = { code, hostId: user.id, players: [db.getUser(user.id)], match: null, hands };
    this.rooms.set(code, room);
    this.userRoom.set(user.id, code);
    this.roomSnapshot(room);
  }

  joinRoom(user, rawCode) {
    const code = String(rawCode || "").trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || room.match) return this.send(user.id, { type: "error", message: "Room not found" });
    if (room.players.some((p) => p.id === user.id)) return this.roomSnapshot(room);
    if (room.players.length >= 3) return this.send(user.id, { type: "error", message: "Room is full" });
    if (this.inQueue(user.id) || this.userMatch.has(user.id)) {
      return this.send(user.id, { type: "error", message: "Leave your current match first" });
    }
    room.players.push(db.getUser(user.id));
    this.userRoom.set(user.id, code);
    if (room.players.length === 3) {
      if (!this.startMatch("friendly", room.players.map((p) => p.id), room)) this.roomSnapshot(room);
    } else this.roomSnapshot(room);
  }

  leaveRoom(userId) {
    const code = this.userRoom.get(userId);
    if (!code) return this.sendLobby(userId);
    const room = this.rooms.get(code);
    if (room && !room.match) {
      room.players = room.players.filter((p) => p.id !== userId);
      this.userRoom.delete(userId);
      if (!room.players.length) this.rooms.delete(code);
      else {
        room.hostId = room.players[0].id;
        this.roomSnapshot(room);
      }
    }
    this.sendLobby(userId);
  }

  bid(userId, value) {
    const match = this.matchFor(userId);
    if (!match) return;
    const game = match.game;
    try {
      game.bid(game.seatOf(userId), Number(value));
    } catch (err) {
      if (err instanceof AllPass) {
        match.redeal();
        this.broadcastMatch(match);
        this.broadcast(match, { type: "info", message: "All passed — redealing" });
        return;
      }
      return this.send(userId, { type: "error", message: err.message });
    }
    this.broadcastMatch(match);
  }

  play(userId, cardIds) {
    const match = this.matchFor(userId);
    if (!match) return;
    try {
      match.game.play(match.game.seatOf(userId), cardIds.map(Number));
    } catch (err) {
      return this.send(userId, { type: "error", message: err.message });
    }
    if (match.game.phase === "over") this.finishHand(match);
    this.broadcastMatch(match);
  }

  pass(userId) {
    const match = this.matchFor(userId);
    if (!match) return;
    try {
      match.game.pass(match.game.seatOf(userId));
    } catch (err) {
      return this.send(userId, { type: "error", message: err.message });
    }
    this.broadcastMatch(match);
  }

  nextHand(userId) {
    const match = this.matchFor(userId);
    if (!match || match.game.phase !== "over" || match.complete) return;
    if (match.markReady(userId)) this.advanceHand(match);
    else this.broadcastMatch(match);
  }

  returnLobby(userId) {
    const match = this.matchFor(userId);
    if (match && !match.complete) {
      return this.send(userId, { type: "error", message: "Match still in progress" });
    }
    this.dropUserMatch(userId);
    this.sendLobby(userId);
  }

  matchFor(userId) {
    const id = this.uid(userId);
    const mid = this.userMatch.get(id);
    return mid ? this.matches.get(mid) : null;
  }

  dropUserMatch(userId) {
    const id = this.uid(userId);
    const mid = this.userMatch.get(id);
    this.userMatch.delete(id);
    this.userRoom.delete(id);
    if (!mid) return;
    const match = this.matches.get(mid);
    if (match && match.userIds.every((uid) => !this.userMatch.has(this.uid(uid)))) this.matches.delete(mid);
  }

  startMatch(room, userIds, lobbyRoom = null) {
    const unique = [...new Set(userIds.map((id) => this.uid(id)))];
    try {
      const users = unique.map((id) => db.getUser(id));
      if (users.length !== 3 || users.some((u) => !u)) throw new Error("Need three players to start");
      const match = new Match({ id: db.gameId(), room, users, hands: lobbyRoom?.hands });
      this.matches.set(match.id, match);
      if (lobbyRoom) lobbyRoom.match = match;
      for (const id of unique) this.userMatch.set(id, match.id);
      this.broadcastMatch(match);
      return true;
    } catch (err) {
      console.error("startMatch failed", room, unique, err);
      if (lobbyRoom) lobbyRoom.match = null;
      for (const id of unique) this.userMatch.delete(id);
      const message = err.message || "Could not start the match";
      for (const id of unique) this.send(id, { type: "error", message });
      return false;
    }
  }

  matchStillSeating(match) {
    const game = match.game;
    return match.handIndex === 0 && game && game.phase === "bid" && game.highestBid === 0;
  }

  cancelMatch(match) {
    for (const id of match.userIds) {
      this.userMatch.delete(id);
      this.userRoom.delete(id);
    }
    for (const room of this.rooms.values()) {
      if (room.match === match) room.match = null;
    }
    this.matches.delete(match.id);
    for (const id of match.userIds) this.sendLobby(id);
  }

  notifyQueue(roomId) {
    if (!roomId || !this.queues[roomId]) return;
    const q = this.queues[roomId];
    for (const uid of q) this.send(uid, { type: "queued", room: roomId, waiting: q.length });
  }

  finishHand(match) {
    const result = match.finishHand();
    if (result === "match" && match.rated && match.placement) {
      db.applyRankResults(match.placement);
    }
  }

  advanceHand(match) {
    match.nextHand();
    this.broadcastMatch(match);
  }

  roomSnapshot(room) {
    const payload = {
      type: "room",
      code: room.code,
      hostId: room.hostId,
      hands: room.hands || 1,
      players: room.players.map((p) => db.publicUser(p)),
    };
    for (const p of room.players) this.send(p.id, payload);
  }

  broadcastMatch(match) {
    for (const id of match.userIds) {
      try {
        this.send(id, { type: "game", state: match.publicState(id) });
      } catch (err) {
        console.error("broadcastMatch failed", id, err);
      }
    }
  }

  broadcast(match, payload) {
    for (const id of match.userIds) this.send(id, payload);
  }

  sendLobby(userId) {
    const user = db.getUser(userId);
    if (user) this.send(userId, { type: "lobby", user: db.publicUser(user), ...this.stats() });
  }

  stats() {
    return { registered: db.userCount(), online: this.sockets.size };
  }

  broadcastStats() {
    const payload = { type: "stats", ...this.stats() };
    for (const id of this.sockets.keys()) this.send(id, payload);
  }

  send(userId, payload) {
    const list = this.sockets.get(this.uid(userId)) || [];
    for (const sock of list) sock.send(payload);
  }
}

export const hub = new Hub();
