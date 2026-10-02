import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import { acceptKey, decodeFrame, encodeFrame } from "./ws.mjs";

const HOST = "127.0.0.1";
const PORT = 8000;

async function api(path, body, token) {
  const res = await fetch(`http://${HOST}:${PORT}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function encodeClient(opcode, data) {
  const payload = Buffer.from(data);
  const mask = randomBytes(4);
  const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
  header[0] = 0x80 | opcode;
  if (payload.length < 126) header[1] = 0x80 | payload.length;
  else {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([header, mask, masked]);
}

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const sock = createConnection({ host: HOST, port: PORT }, () => {
      sock.write(
        `GET /ws?token=${encodeURIComponent(token)} HTTP/1.1\r\nHost: ${HOST}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let buf = Buffer.alloc(0);
    let handshake = false;
    const pending = [];
    const waiters = [];
    const client = {
      send: (obj) => sock.write(encodeClient(0x1, JSON.stringify(obj))),
      next: () =>
        new Promise((res) => {
          if (pending.length) res(pending.shift());
          else waiters.push(res);
        }),
      close: () => sock.end(),
    };
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshake) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx < 0) return;
        const head = buf.subarray(0, idx).toString();
        buf = buf.subarray(idx + 4);
        if (!head.includes(acceptKey(key))) return reject(new Error(head));
        handshake = true;
        resolve(client);
      }
      let frame = decodeFrame(buf);
      while (frame) {
        buf = frame.rest;
        if (frame.opcode === 0x1) {
          const msg = JSON.parse(frame.payload.toString());
          if (waiters.length) waiters.shift()(msg);
          else pending.push(msg);
        }
        frame = decodeFrame(buf);
      }
    });
    sock.on("error", reject);
  });
}

function waitType(client, types) {
  return (async () => {
    const want = Array.isArray(types) ? types : [types];
    for (let i = 0; i < 30; i++) {
      const msg = await client.next();
      if (want.includes(msg.type)) return msg;
    }
    throw new Error("timeout waiting for " + want.join("/"));
  })();
}

const suffix = Date.now().toString(36);
const names = ["p1", "p2", "p3"].map((n) => n + suffix);
const sessions = [];
for (const username of names) {
  sessions.push(await api("/api/register", { username, password: "pass1234" }));
}

const sockets = [];
for (const s of sessions) sockets.push(await connectWs(s.token));
for (const s of sockets) {
  const msg = await waitType(s, "lobby");
  if (msg.type !== "lobby") throw new Error("expected lobby " + msg.type);
}
for (const s of sockets) s.send({ type: "queue", room: "farm" });
const games = [];
for (const s of sockets) {
  const msg = await waitType(s, ["queued", "game"]);
  games.push(msg.type === "game" ? msg : await waitType(s, "game"));
}
if (!games.every((g) => g.type === "game" && g.state.match?.room === "farm" && g.state.match?.totalHands === 3)) {
  throw new Error("farm match failed " + JSON.stringify(games[0]));
}
if (new Set(games[0].state.players.map((p) => p.seat)).size !== 3) throw new Error("seats");

const friend = [];
for (const username of ["f1", "f2", "f3"].map((n) => n + suffix)) {
  friend.push(await api("/api/register", { username, password: "pass1234" }));
}
const fws = [];
for (const s of friend) fws.push(await connectWs(s.token));
for (const s of fws) await waitType(s, "lobby");
fws[0].send({ type: "create_room" });
const room = await waitType(fws[0], "room");
if (room.type !== "room" || !room.code) throw new Error("no room");
fws[1].send({ type: "join_room", code: room.code });
await waitType(fws[1], "room");
fws[2].send({ type: "join_room", code: room.code });
const started = await waitType(fws[2], "game");
if (started.type !== "game" || started.state.mode !== "friendly") throw new Error("friendly start failed");

const blocked = await api("/api/register", { username: "city" + suffix, password: "pass1234" });
const bws = await connectWs(blocked.token);
await waitType(bws, "lobby");
bws.send({ type: "queue", room: "city" });
const denied = await waitType(bws, "error");
if (denied.type !== "error") throw new Error("expected city lockout " + JSON.stringify(denied));

for (const s of [...sockets, ...fws, bws]) s.close();
console.log("matchmaking tests passed", room.code);
process.exit(0);
