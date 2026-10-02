import { AllPass, ComboKind, Game, beats, parseCombo } from "./engine.mjs";

function C(...specs) {
  return specs.map((spec, id) =>
    spec === "BJ" || spec === "RJ"
      ? { id, rank: spec, suit: null }
      : { id, rank: spec.slice(0, -1), suit: spec.slice(-1) },
  );
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const rocket = parseCombo(C("BJ", "RJ"));
const bomb = parseCombo(C("7S", "7H", "7D", "7C"));
assert(rocket.kind === ComboKind.ROCKET, "rocket");
assert(beats(rocket, bomb), "rocket beats bomb");
assert(beats(bomb, parseCombo(C("3S"))), "bomb beats single");
assert(parseCombo(C("3S", "4H", "5D", "6C", "7S")).kind === ComboKind.STRAIGHT, "straight");
assert(!parseCombo(C("3S", "4H", "5D", "6C", "2S")), "no 2 in straight");
assert(beats(parseCombo(C("9S", "9H")), parseCombo(C("5S", "5H"))), "pair order");
assert(parseCombo(C("4S", "4H", "4D", "5S", "5H", "5D")).kind === ComboKind.AIRPLANE, "plane");

const users = [
  { id: 1, username: "a", rating: 1000 },
  { id: 2, username: "b", rating: 1000 },
  { id: 3, username: "c", rating: 1000 },
];
const game = new Game({ id: "g", mode: "rated", users, rng: () => 0.1 });
game.bid(game.turn, 0);
game.bid(game.turn, 0);
try {
  game.bid(game.turn, 0);
  assert(false, "should redeal");
} catch (err) {
  assert(err instanceof AllPass, "all pass");
}

function scoredGame(mode) {
  const g = new Game({ id: "s", mode, users, rng: () => 0.1 });
  g.becomeLandlord(0);
  g.highestBid = 3;
  g.bombCount = 2;
  g.hasPlayed = [true, false, false];
  g.finish(0);
  return g;
}

const friendly = scoredGame("friendly");
assert(friendly.baseScore === 24, "spring score 3×4×2");
assert(friendly.scoreDeltas[0] === 48 && friendly.scoreDeltas[1] === -24 && friendly.scoreDeltas[2] === -24, "landlord ±2S");

const rated = scoredGame("rated");
assert(rated.scoreDeltas[0] === 48, "rated hand score");

const noSpring = scoredGame("friendly");
noSpring.phase = "play";
noSpring.hasPlayed = [true, true, false];
noSpring.spring = false;
noSpring.finish(0);
assert(noSpring.baseScore === 12 && noSpring.scoreDeltas[0] === 24, "no spring 3×4");

const peasants = scoredGame("friendly");
peasants.phase = "play";
peasants.hasPlayed = [true, true, true];
peasants.finish(1);
assert(peasants.baseScore === 12 && peasants.scoreDeltas[0] === -24 && peasants.scoreDeltas[1] === 12, "peasant win");

console.log("engine tests passed");
