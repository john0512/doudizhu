import { Game } from "./engine.mjs";
import { ROOMS, formatRank, settleMatch, shuffleUsers } from "./ranks.mjs";

export class Match {
  constructor({ id, room, users, hands = 1, rng = Math.random }) {
    this.id = id;
    this.room = room;
    this.rated = room !== "friendly";
    const friendlyHands = [1, 3, 6, 9].includes(Number(hands)) ? Number(hands) : 1;
    this.config = this.rated
      ? ROOMS[room]
      : { name: "Friendly", orbits: friendlyHands >= 3 ? friendlyHands / 3 : 0, firstPlace: 0 };
    this.users = shuffleUsers(users, rng);
    this.userIds = this.users.map((u) => u.id);
    this.matchScores = [0, 0, 0];
    this.handIndex = 0;
    this.totalHands = this.rated ? this.config.orbits * 3 : friendlyHands;
    this.connected = [true, true, true];
    this.ready = [false, false, false];
    this.complete = false;
    this.placement = null;
    this.game = this.deal();
  }

  seatOf(userId) {
    const seat = this.userIds.findIndex((id) => id == userId);
    if (seat < 0) throw new Error("Not in this match");
    return seat;
  }

  firstBidder() {
    return this.handIndex % 3;
  }

  deal() {
    const game = new Game({
      id: this.id,
      mode: this.rated ? "rated" : "friendly",
      users: this.users,
      firstBidder: this.firstBidder(),
    });
    game.connected = [...this.connected];
    this.game = game;
    this.ready = [false, false, false];
    return game;
  }

  redeal() {
    return this.deal();
  }

  setConnected(userId, ok) {
    const seat = this.seatOf(userId);
    this.connected[seat] = ok;
    if (this.game) this.game.connected[seat] = ok;
  }

  finishHand() {
    const deltas = this.game.scoreDeltas;
    this.matchScores = this.matchScores.map((n, i) => n + deltas[i]);
    if (this.handIndex + 1 >= this.totalHands) {
      this.complete = true;
      if (this.rated) this.placement = settleMatch(this.users, this.matchScores, this.room);
      else {
        const order = [0, 1, 2].sort((a, b) => this.matchScores[b] - this.matchScores[a] || a - b);
        this.placement = order.map((seat, i) => ({
          seat,
          userId: this.userIds[seat],
          username: this.users[seat].username,
          place: i + 1,
          delta: 0,
          rank: this.users[seat].rank,
          rankPoints: this.users[seat].rankPoints,
        }));
      }
      return "match";
    }
    return "hand";
  }

  markReady(userId) {
    this.ready[this.seatOf(userId)] = true;
    return this.allReady();
  }

  allReady() {
    return this.userIds.every((_, i) => this.ready[i] || !this.connected[i]);
  }

  nextHand() {
    this.handIndex += 1;
    return this.deal();
  }

  publicMatch() {
    return {
      room: this.room,
      roomName: this.config.name,
      rated: this.rated,
      orbits: this.config.orbits || 0,
      orbit: this.totalHands > 1 ? Math.floor(this.handIndex / 3) + 1 : 1,
      hand: this.handIndex + 1,
      totalHands: this.totalHands,
      firstBidder: this.firstBidder(),
      scores: this.matchScores,
      ready: this.ready,
      complete: this.complete,
      placement: this.placement,
    };
  }

  publicState(viewerId) {
    const state = this.game.publicState(viewerId);
    state.match = this.publicMatch();
    state.players = state.players.map((p, seat) => ({
      ...p,
      rankLabel: formatRank(this.users[seat].rank, this.users[seat].rankPoints),
      matchScore: this.matchScores[seat],
    }));
    return state;
  }
}
