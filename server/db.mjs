import { createHash, pbkdf2Sync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rankLabel, comparePlayers } from "./ranks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATH = join(ROOT, "data", "store.json");
const ITERATIONS = 210000;

function empty() {
  return { nextId: 1, users: [], sessions: [] };
}

function load() {
  try {
    const store = JSON.parse(readFileSync(PATH, "utf8"));
    for (const user of store.users || []) {
      if (!user.rank) {
        user.rank = "peasant";
        user.rankPoints = 0;
      }
    }
    return store;
  } catch {
    return empty();
  }
}

function save(store) {
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(PATH, JSON.stringify(store, null, 2));
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const digest = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256").toString("hex");
  return `${salt}$${digest}`;
}

function verifyPassword(password, stored) {
  const salt = stored.split("$")[0];
  const next = hashPassword(password, salt);
  const a = Buffer.from(next);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function publicUser(user) {
  if (!user) return null;
  const rank = user.rank || "peasant";
  const rankPoints = user.rankPoints ?? 0;
  return { id: user.id, username: user.username, rank, rankPoints, rankLabel: rankLabel({ rank, rankPoints }) };
}

export function createUser(username, password) {
  const store = load();
  if (store.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("Username already taken");
  }
  const user = {
    id: store.nextId++,
    username,
    passwordHash: hashPassword(password),
    rank: "peasant",
    rankPoints: 0,
    createdAt: Date.now(),
  };
  store.users.push(user);
  save(store);
  return publicUser(user);
}

export function login(username, password) {
  const store = load();
  const user = store.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error("Wrong username or password");
  }
  return user;
}

export function normId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

export function getUser(id) {
  const want = normId(id);
  return load().users.find((u) => u.id == want) || null;
}

export function createSession(userId) {
  const store = load();
  const token = randomBytes(24).toString("base64url");
  store.sessions.push({ token, userId, createdAt: Date.now() });
  save(store);
  return token;
}

export function userForToken(token) {
  if (!token) return null;
  const store = load();
  const session = store.sessions.find((s) => s.token === token);
  if (!session) return null;
  const user = store.users.find((u) => u.id == session.userId);
  return user ? publicUser(user) : null;
}

export function applyRankResults(results) {
  const store = load();
  for (const row of results) {
    const user = store.users.find((u) => u.id === row.userId);
    if (!user) continue;
    user.rank = row.rank;
    user.rankPoints = row.rankPoints;
  }
  save(store);
}

export function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export function leaderboard(limit = 20) {
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  return load()
    .users.map((u) => publicUser(u))
    .sort(comparePlayers)
    .slice(0, n)
    .map((u, i) => ({ place: i + 1, ...u }));
}

export function userCount() {
  return load().users.length;
}

export function gameId() {
  return createHash("sha1").update(randomBytes(16)).digest("hex").slice(0, 16);
}

export { ROOT };
