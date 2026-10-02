import { applyRankDelta, canJoinRoom, comparePlayers, placeSeats, settleMatch, thirdPlaceLoss } from "./ranks.mjs";
import { Match } from "./match.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(applyRankDelta("peasant", 8, 5).rank === "dan1" && applyRankDelta("peasant", 8, 5).rankPoints === 10, "promote to midpoint");
assert(applyRankDelta("dan1", 1, -2).rank === "peasant" && applyRankDelta("dan1", 1, -2).rankPoints === 0, "demote to midpoint");
assert(applyRankDelta("peasant", 0, 0).rankPoints === 0, "peasant 3rd is 0");
assert(applyRankDelta("dan9", 395, 14).rank === "landlord" && applyRankDelta("dan9", 395, 14).rankPoints === 200, "excess discarded on promo");
assert(applyRankDelta("landlord", 10, -(18 + Math.floor(10 / 200))).rank === "dan9", "landlord demote");
assert(applyRankDelta("landlord", 10, -(18 + Math.floor(10 / 200))).rankPoints === 200, "landlord demote midpoint");
assert(thirdPlaceLoss("peasant", 0) === 0, "peasant 3rd");
assert(thirdPlaceLoss("dan1", 12) === 2, "1 dan 3rd");
assert(thirdPlaceLoss("dan9", 200) === 18, "9 dan 3rd");
assert(thirdPlaceLoss("landlord", 450) === 20, "landlord 3rd 18+floor(450/200)");
assert(placeSeats([10, 10, 3]).join() === "0,1,2", "tie earlier seat");
assert(placeSeats([4, 9, 9]).join() === "1,2,0", "tie then lower seat");
assert(canJoinRoom("farm", "peasant") && canJoinRoom("farm", "dan4") && !canJoinRoom("farm", "dan5"), "farm range");
assert(canJoinRoom("city", "dan7") && canJoinRoom("city", "landlord") && !canJoinRoom("city", "dan6"), "city range");
assert(canJoinRoom("plantation", "dan3") && canJoinRoom("plantation", "dan6"), "plantation");

const boardOrder = [
  { username: "low", rank: "peasant", rankPoints: 9 },
  { username: "mid", rank: "dan1", rankPoints: 12 },
  { username: "top", rank: "dan1", rankPoints: 18 },
  { username: "aaa", rank: "peasant", rankPoints: 9 },
].sort(comparePlayers);
assert(boardOrder.map((u) => u.username).join() === "top,mid,aaa,low", "leaderboard sort");

const settled = settleMatch(
  [
    { id: 1, username: "a", rank: "peasant", rankPoints: 8 },
    { id: 2, username: "b", rank: "dan1", rankPoints: 10 },
    { id: 3, username: "c", rank: "dan1", rankPoints: 11 },
  ],
  [12, 5, -4],
  "farm",
);
assert(settled[0].place === 1 && settled[0].delta === 5 && settled[0].rank === "dan1", "farm 1st");
assert(settled[1].place === 2 && settled[1].delta === 0, "2nd zero");
assert(settled[2].place === 3 && settled[2].delta === -2, "3rd dan loss");

const m = new Match({
  id: "m",
  room: "farm",
  users: [
    { id: 1, username: "a", rank: "peasant", rankPoints: 0 },
    { id: 2, username: "b", rank: "peasant", rankPoints: 0 },
    { id: 3, username: "c", rank: "peasant", rankPoints: 0 },
  ],
  rng: () => 0,
});
assert(m.totalHands === 3 && m.game.firstBidder === 0, "farm 1 orbit starts at seat 0");
m.game.scoreDeltas = [6, -3, -3];
assert(m.finishHand() === "hand", "not done after hand 1");
m.nextHand();
assert(m.handIndex === 1 && m.game.firstBidder === 1, "second dealer rotates");
m.game.scoreDeltas = [0, 2, -2];
m.finishHand();
m.nextHand();
assert(m.game.firstBidder === 2, "third dealer");
m.game.scoreDeltas = [-4, 2, 2];
assert(m.finishHand() === "match", "farm match ends");
assert(m.placement[0].place === 1 && m.placement[0].delta === 5, "placement from totals");

const friendlyLong = new Match({
  id: "f",
  room: "friendly",
  hands: 9,
  users: [
    { id: 1, username: "a", rank: "peasant", rankPoints: 0 },
    { id: 2, username: "b", rank: "peasant", rankPoints: 0 },
    { id: 3, username: "c", rank: "peasant", rankPoints: 0 },
  ],
  rng: () => 0,
});
assert(friendlyLong.totalHands === 9 && friendlyLong.config.orbits === 3, "friendly 9 hands");

console.log("rank tests passed");
