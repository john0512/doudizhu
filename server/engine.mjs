export const RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "BJ", "RJ"];
export const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const STRAIGHT_RANKS = new Set(RANKS.slice(0, 12));
const SUITS = ["S", "H", "D", "C"];

export const ComboKind = {
  SINGLE: "single",
  PAIR: "pair",
  TRIPLE: "triple",
  TRIPLE_SINGLE: "triple_single",
  TRIPLE_PAIR: "triple_pair",
  STRAIGHT: "straight",
  PAIR_STRAIGHT: "pair_straight",
  AIRPLANE: "airplane",
  AIRPLANE_SINGLE: "airplane_single",
  AIRPLANE_PAIR: "airplane_pair",
  FOUR_TWO: "four_two",
  FOUR_TWO_PAIR: "four_two_pair",
  BOMB: "bomb",
  ROCKET: "rocket",
};

export function fullDeck() {
  const cards = [];
  let id = 0;
  for (const rank of RANKS.slice(0, -2)) {
    for (const suit of SUITS) cards.push({ id: id++, rank, suit });
  }
  cards.push({ id: id++, rank: "BJ", suit: null });
  cards.push({ id: id++, rank: "RJ", suit: null });
  return cards;
}

function counts(cards) {
  const grouped = {};
  for (const card of cards) {
    (grouped[card.rank] ||= []).push(card);
  }
  return grouped;
}

function sortedValues(ranks) {
  return [...ranks].map((r) => RANK_VALUE[r]).sort((a, b) => a - b);
}

function consecutive(values) {
  if (!values.length) return false;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered.every((v, i) => v === ordered[0] + i);
}

export function parseCombo(cards) {
  if (!cards.length) return null;
  const sorted = [...cards].sort((a, b) => a.rank === b.rank
    ? String(a.suit).localeCompare(String(b.suit))
    : RANK_VALUE[a.rank] - RANK_VALUE[b.rank]);
  const n = sorted.length;
  const grouped = counts(sorted);
  const ranks = Object.keys(grouped);
  const rankSet = new Set(ranks);
  const sizes = ranks.map((r) => [grouped[r].length, r]).sort((a, b) => b[0] - a[0] || RANK_VALUE[b[1]] - RANK_VALUE[a[1]]);

  if (n === 2 && rankSet.has("BJ") && rankSet.has("RJ")) {
    return { kind: ComboKind.ROCKET, rank: RANK_VALUE.RJ, length: 2, cards: sorted };
  }
  if (n === 4 && ranks.length === 1) {
    return { kind: ComboKind.BOMB, rank: RANK_VALUE[ranks[0]], length: 4, cards: sorted };
  }
  if (n === 1) return { kind: ComboKind.SINGLE, rank: RANK_VALUE[sorted[0].rank], length: 1, cards: sorted };
  if (n === 2 && ranks.length === 1) return { kind: ComboKind.PAIR, rank: RANK_VALUE[ranks[0]], length: 2, cards: sorted };
  if (n === 3 && ranks.length === 1) return { kind: ComboKind.TRIPLE, rank: RANK_VALUE[ranks[0]], length: 3, cards: sorted };
  if (n === 4 && sizes[0][0] === 3 && sizes[1][0] === 1) {
    return { kind: ComboKind.TRIPLE_SINGLE, rank: RANK_VALUE[sizes[0][1]], length: 4, cards: sorted };
  }
  if (n === 5 && sizes[0][0] === 3 && sizes[1][0] === 2) {
    return { kind: ComboKind.TRIPLE_PAIR, rank: RANK_VALUE[sizes[0][1]], length: 5, cards: sorted };
  }
  if (n === 6 && sizes[0][0] === 4 && ranks.length === 3 && ranks.every((r) => r === sizes[0][1] || grouped[r].length === 1)) {
    return { kind: ComboKind.FOUR_TWO, rank: RANK_VALUE[sizes[0][1]], length: 6, cards: sorted };
  }
  if (n === 6 && sizes[0][0] === 4 && ranks.length === 2 && sizes[1][0] === 2) {
    return { kind: ComboKind.FOUR_TWO, rank: RANK_VALUE[sizes[0][1]], length: 6, cards: sorted };
  }
  if (n === 8 && sizes[0][0] === 4) {
    const pairs = ranks.filter((r) => grouped[r].length === 2);
    if (pairs.length === 2 && !pairs.includes(sizes[0][1])) {
      return { kind: ComboKind.FOUR_TWO_PAIR, rank: RANK_VALUE[sizes[0][1]], length: 8, cards: sorted };
    }
  }
  if (ranks.every((r) => grouped[r].length === 1) && n >= 5) {
    if ([...rankSet].every((r) => STRAIGHT_RANKS.has(r)) && consecutive(sortedValues(ranks))) {
      return { kind: ComboKind.STRAIGHT, rank: Math.min(...sortedValues(ranks)), length: n, cards: sorted };
    }
  }
  if (ranks.every((r) => grouped[r].length === 2) && n >= 6 && n % 2 === 0) {
    if ([...rankSet].every((r) => STRAIGHT_RANKS.has(r)) && consecutive(sortedValues(ranks))) {
      return { kind: ComboKind.PAIR_STRAIGHT, rank: Math.min(...sortedValues(ranks)), length: n / 2, cards: sorted };
    }
  }
  const tripleRanks = ranks.filter((r) => grouped[r].length === 3);
  if (tripleRanks.length && tripleRanks.every((r) => STRAIGHT_RANKS.has(r))) {
    const tvals = sortedValues(tripleRanks);
    if (consecutive(tvals)) {
      const chain = tripleRanks.length;
      const leftover = sorted.filter((c) => !tripleRanks.includes(c.rank));
      const leftoverGroup = counts(leftover);
      if (!leftover.length) return { kind: ComboKind.AIRPLANE, rank: Math.min(...tvals), length: chain, cards: sorted };
      if (leftover.length === chain && Object.values(leftoverGroup).every((cs) => cs.length <= 2)) {
        return { kind: ComboKind.AIRPLANE_SINGLE, rank: Math.min(...tvals), length: chain, cards: sorted };
      }
      if (leftover.length === chain * 2 && Object.values(leftoverGroup).every((cs) => cs.length === 2)) {
        return { kind: ComboKind.AIRPLANE_PAIR, rank: Math.min(...tvals), length: chain, cards: sorted };
      }
    }
  }
  return null;
}

export function beats(play, current) {
  if (!current) return true;
  if (play.kind === ComboKind.ROCKET) return true;
  if (current.kind === ComboKind.ROCKET) return false;
  if (play.kind === ComboKind.BOMB && current.kind !== ComboKind.BOMB) return true;
  if (play.kind === ComboKind.BOMB && current.kind === ComboKind.BOMB) return play.rank > current.rank;
  return play.kind === current.kind && play.length === current.length && play.rank > current.rank;
}

export class AllPass extends Error {}

function sortHand(cards) {
  return [...cards].sort((a, b) => RANK_VALUE[a.rank] - RANK_VALUE[b.rank] || String(a.suit).localeCompare(String(b.suit)));
}

export class Game {
  constructor({ id, mode, users, firstBidder = null, rng = Math.random }) {
    const deck = fullDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this.id = id;
    this.mode = mode;
    this.userIds = users.map((u) => u.id);
    this.usernames = users.map((u) => u.username);
    this.ranks = users.map((u) => u.rank || "peasant");
    this.rankPoints = users.map((u) => u.rankPoints ?? 0);
    this.hands = [0, 1, 2].map((i) => sortHand(deck.slice(i * 17, i * 17 + 17)));
    this.bottom = deck.slice(51);
    this.phase = "bid";
    this.landlord = null;
    this.turn = firstBidder == null ? Math.floor(rng() * 3) : firstBidder;
    this.firstBidder = this.turn;
    this.highestBid = 0;
    this.highestBidder = null;
    this.passedBids = 0;
    this.lastCombo = null;
    this.lastPlayer = null;
    this.passes = 0;
    this.bombCount = 0;
    this.hasPlayed = [false, false, false];
    this.winnerSeat = null;
    this.landlordWon = null;
    this.spring = false;
    this.baseScore = 0;
    this.scoreDeltas = [0, 0, 0];
    this.bidLog = [];
    this.lastAction = null;
    this.connected = [true, true, true];
  }

  noteAction(kind, seat, extra = {}) {
    this.lastAction = { kind, seat, username: this.usernames[seat], ...extra };
  }

  seatOf(userId) {
    const seat = this.userIds.findIndex((id) => id == userId);
    if (seat < 0) throw new Error("Not in this game");
    return seat;
  }

  bid(seat, value) {
    if (this.phase !== "bid") throw new Error("Not in bidding");
    if (seat !== this.turn) throw new Error("Not your turn");
    if (![0, 1, 2, 3].includes(value)) throw new Error("Bid must be 0-3");
    if (value !== 0 && value <= this.highestBid) throw new Error("Bid must be higher");
    this.bidLog.push({ seat, value });
    this.noteAction("bid", seat, { value });
    if (value === 0) {
      this.passedBids += 1;
      if (this.highestBidder == null && this.passedBids === 3) throw new AllPass();
      if (this.highestBidder != null && this.passedBids >= 2) {
        this.becomeLandlord(this.highestBidder);
        return;
      }
      this.turn = (this.turn + 1) % 3;
      return;
    }
    this.highestBid = value;
    this.highestBidder = seat;
    this.passedBids = 0;
    if (value === 3) {
      this.becomeLandlord(seat);
      return;
    }
    this.turn = (seat + 1) % 3;
  }

  becomeLandlord(seat) {
    this.landlord = seat;
    this.hands[seat] = sortHand(this.hands[seat].concat(this.bottom));
    if (this.highestBid === 0) this.highestBid = 1;
    this.phase = "play";
    this.turn = seat;
    this.lastCombo = null;
    this.lastPlayer = null;
    this.passes = 0;
  }

  play(seat, cardIds) {
    if (this.phase !== "play") throw new Error("Not in play");
    if (seat !== this.turn) throw new Error("Not your turn");
    const hand = this.hands[seat];
    const byId = Object.fromEntries(hand.map((c) => [c.id, c]));
    if (cardIds.some((id) => !byId[id])) throw new Error("You do not have those cards");
    const chosen = cardIds.map((id) => byId[id]);
    const combo = parseCombo(chosen);
    if (!combo) throw new Error("Invalid combination");
    const lead = this.lastCombo == null || this.lastPlayer === seat;
    if (!lead && !beats(combo, this.lastCombo)) throw new Error("Must beat the last play");
    const used = new Set(cardIds);
    this.hands[seat] = hand.filter((c) => !used.has(c.id));
    this.lastCombo = combo;
    this.lastPlayer = seat;
    this.noteAction("play", seat);
    this.passes = 0;
    this.hasPlayed[seat] = true;
    if (combo.kind === ComboKind.BOMB || combo.kind === ComboKind.ROCKET) this.bombCount += 1;
    if (!this.hands[seat].length) this.finish(seat);
    else this.turn = (seat + 1) % 3;
    return combo;
  }

  pass(seat) {
    if (this.phase !== "play") throw new Error("Not in play");
    if (seat !== this.turn) throw new Error("Not your turn");
    if (this.lastCombo == null || this.lastPlayer === seat) throw new Error("You must lead");
    this.noteAction("pass", seat);
    this.passes += 1;
    if (this.passes >= 2) {
      this.lastCombo = null;
      this.lastPlayer = null;
      this.passes = 0;
    }
    this.turn = (seat + 1) % 3;
  }

  finish(winnerSeat) {
    this.phase = "over";
    this.winnerSeat = winnerSeat;
    this.landlordWon = winnerSeat === this.landlord;
    const landlord = this.landlord;
    const peasants = [0, 1, 2].filter((s) => s !== landlord);
    this.spring = Boolean(this.landlordWon && peasants.every((s) => !this.hasPlayed[s]));
    let score = Math.max(this.highestBid, 1) * 2 ** this.bombCount;
    if (this.spring) score *= 2;
    this.baseScore = score;
    this.scoreDeltas = [0, 1, 2].map((s) => {
      if (this.landlordWon) return s === landlord ? score * 2 : -score;
      return s === landlord ? -score * 2 : score;
    });
  }

  publicState(viewerId) {
    const viewer = this.userIds.findIndex((id) => id == viewerId);
    return {
      gameId: this.id,
      mode: this.mode,
      phase: this.phase,
      turn: this.turn,
      viewerSeat: viewer,
      highestBid: this.highestBid,
      bottom: this.phase === "bid" ? this.bottom.map(() => ({ hidden: true })) : this.bottom,
      lastCombo: this.lastCombo,
      lastPlayer: this.lastPlayer,
      lastAction: this.lastAction,
      winnerSeat: this.winnerSeat,
      landlordWon: this.landlordWon,
      spring: this.spring,
      baseScore: this.phase === "over" ? this.baseScore : null,
      scoreDeltas: this.phase === "over" ? this.scoreDeltas : null,
      bombCount: this.bombCount,
      firstBidder: this.firstBidder,
      players: [0, 1, 2].map((seat) => ({
        userId: this.userIds[seat],
        username: this.usernames[seat],
        seat,
        cardCount: this.hands[seat].length,
        isLandlord: this.landlord === seat,
        connected: this.connected[seat],
        hand: seat === viewer ? this.hands[seat] : null,
      })),
    };
  }
}
