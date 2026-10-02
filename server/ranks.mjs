export const RANKS = [
  { id: "peasant", name: "Peasant", dan: 0, start: 0, threshold: 10 },
  { id: "dan1", name: "1 Dan", dan: 1, start: 10, threshold: 20 },
  { id: "dan2", name: "2 Dan", dan: 2, start: 20, threshold: 40 },
  { id: "dan3", name: "3 Dan", dan: 3, start: 30, threshold: 60 },
  { id: "dan4", name: "4 Dan", dan: 4, start: 40, threshold: 80 },
  { id: "dan5", name: "5 Dan", dan: 5, start: 50, threshold: 100 },
  { id: "dan6", name: "6 Dan", dan: 6, start: 70, threshold: 140 },
  { id: "dan7", name: "7 Dan", dan: 7, start: 100, threshold: 200 },
  { id: "dan8", name: "8 Dan", dan: 8, start: 150, threshold: 300 },
  { id: "dan9", name: "9 Dan", dan: 9, start: 200, threshold: 400 },
  { id: "landlord", name: "Landlord", dan: 10, start: 200, threshold: null },
];

export const ROOMS = {
  farm: {
    id: "farm",
    name: "Farm",
    orbits: 1,
    firstPlace: 5,
    minDan: 0,
    maxDan: 4,
    range: "Peasant – 4 Dan",
  },
  plantation: {
    id: "plantation",
    name: "Plantation",
    orbits: 2,
    firstPlace: 8,
    minDan: 3,
    maxDan: 6,
    range: "3 Dan – 6 Dan",
  },
  apartment: {
    id: "apartment",
    name: "Apartment",
    orbits: 3,
    firstPlace: 11,
    minDan: 5,
    maxDan: 8,
    range: "5 Dan – 8 Dan",
  },
  city: {
    id: "city",
    name: "City",
    orbits: 3,
    firstPlace: 14,
    minDan: 7,
    maxDan: 10,
    range: "7 Dan and above",
  },
};

export function getRank(id) {
  return RANKS.find((r) => r.id === id) || RANKS[0];
}

export function formatRank(rankId, points) {
  const rank = getRank(rankId);
  if (rank.threshold == null) return `${rank.name} ${points}`;
  return `${rank.name} ${points}/${rank.threshold}`;
}

export function canJoinRoom(roomId, rankId) {
  const room = ROOMS[roomId];
  if (!room) return false;
  const dan = getRank(rankId).dan;
  return dan >= room.minDan && dan <= room.maxDan;
}

export function joinError(roomId, rankId) {
  const room = ROOMS[roomId];
  if (!room) return "Unknown room";
  return `${room.name} is for ${room.range}. You are ${getRank(rankId).name}.`;
}

export function thirdPlaceLoss(rankId, points) {
  const rank = getRank(rankId);
  if (rank.id === "landlord") return 18 + Math.floor(Math.max(0, points) / 200);
  return 2 * rank.dan;
}

export function applyRankDelta(rankId, points, delta) {
  let index = Math.max(0, RANKS.findIndex((r) => r.id === rankId));
  let value = points + delta;
  while (RANKS[index].threshold != null && value >= RANKS[index].threshold) {
    index += 1;
    value = RANKS[index].start;
  }
  while (value < 0) {
    if (index === 0) {
      value = 0;
      break;
    }
    index -= 1;
    value = RANKS[index].start;
  }
  return { rank: RANKS[index].id, rankPoints: value };
}

export function placeSeats(scores) {
  return [0, 1, 2].sort((a, b) => scores[b] - scores[a] || a - b);
}

export function settleMatch(users, scores, roomId) {
  const room = ROOMS[roomId];
  const order = placeSeats(scores);
  return order.map((seat, i) => {
    const place = i + 1;
    const user = users[seat];
    const delta =
      place === 1 ? room.firstPlace : place === 2 ? 0 : -thirdPlaceLoss(user.rank, user.rankPoints);
    const after = applyRankDelta(user.rank, user.rankPoints, delta);
    return {
      seat,
      userId: user.id,
      username: user.username,
      place,
      delta,
      beforeRank: user.rank,
      beforePoints: user.rankPoints,
      ...after,
    };
  });
}

export function snapshotUser(user) {
  return {
    id: user.id,
    username: user.username,
    rank: user.rank || "peasant",
    rankPoints: user.rankPoints ?? 0,
  };
}

export function shuffleUsers(users, rng = Math.random) {
  const arr = users.map(snapshotUser);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function rankLabel(user) {
  return formatRank(user.rank || "peasant", user.rankPoints ?? 0);
}

export function comparePlayers(a, b) {
  const danA = getRank(a.rank).dan;
  const danB = getRank(b.rank).dan;
  if (danB !== danA) return danB - danA;
  const ptsA = a.rankPoints ?? 0;
  const ptsB = b.rankPoints ?? 0;
  if (ptsB !== ptsA) return ptsB - ptsA;
  return String(a.username || "").localeCompare(String(b.username || ""));
}
