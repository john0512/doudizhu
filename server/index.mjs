import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { hub } from "./hub.mjs";
import * as db from "./db.mjs";
import { acceptKey, attachWebSocket } from "./ws.mjs";

const CLIENT = join(db.ROOT, "client");
const PORT = Number(process.env.PORT || 8000);
const USER_RE = /^[a-zA-Z0-9_]{3,16}$/;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function bearer(req) {
  const header = req.headers.authorization || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return db.userForToken(header.slice(7).trim());
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/static\//, "");
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = join(CLIENT, rel);
  if (!file.startsWith(CLIENT)) return json(res, 403, { detail: "Forbidden" });
  try {
    if (!statSync(file).isFile()) throw new Error("dir");
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    json(res, 404, { detail: "Not found" });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/api/register") {
      const body = await readBody(req);
      if (!USER_RE.test(body.username || "")) return json(res, 400, { detail: "Username must be 3-16 letters, numbers, or underscores" });
      if (!body.password || String(body.password).length < 4) return json(res, 400, { detail: "Password is too short" });
      try {
        const user = db.createUser(body.username, body.password);
        const token = db.createSession(user.id);
        return json(res, 200, { token, user });
      } catch (err) {
        return json(res, 400, { detail: err.message });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      try {
        const user = db.login(body.username, body.password);
        const token = db.createSession(user.id);
        return json(res, 200, { token, user: db.publicUser(user) });
      } catch (err) {
        return json(res, 400, { detail: err.message });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/me") {
      const user = bearer(req);
      if (!user) return json(res, 401, { detail: "Login required" });
      return json(res, 200, { user });
    }
    if (req.method === "GET" && url.pathname === "/api/stats") {
      return json(res, 200, hub.stats());
    }
    if (req.method === "GET" && url.pathname === "/api/leaderboard") {
      return json(res, 200, { players: db.leaderboard(20) });
    }
    if (req.method === "GET") return serveStatic(req, res);
    json(res, 404, { detail: "Not found" });
  } catch {
    json(res, 400, { detail: "Bad request" });
  }
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const user = db.userForToken(url.searchParams.get("token"));
  const key = req.headers["sec-websocket-key"];
  if (!user || !key) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  const { send, closer } = attachWebSocket(
    socket,
    (msg) => {
      if (msg.type === "queue") hub.queueRoom(user, msg.room);
      else if (msg.type === "leave_queue") hub.leaveQueue(user.id);
      else if (msg.type === "create_room") hub.createRoom(user, msg.hands);
      else if (msg.type === "join_room") hub.joinRoom(user, msg.code);
      else if (msg.type === "leave_room") hub.leaveRoom(user.id);
      else if (msg.type === "bid") hub.bid(user.id, msg.value);
      else if (msg.type === "play") hub.play(user.id, msg.cards || []);
      else if (msg.type === "pass") hub.pass(user.id);
      else if (msg.type === "next_hand") hub.nextHand(user.id);
      else if (msg.type === "lobby") hub.returnLobby(user.id);
      else if (msg.type === "flush_queue") hub.flushQueues();
    },
    () => hub.disconnect(user.id, closer),
  );
  hub.connect(user, send, closer);
});

function lanUrls() {
  const urls = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) urls.push(`http://${net.address}:${PORT}`);
    }
  }
  return urls;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Dou Dizhu on this Mac: http://127.0.0.1:${PORT}`);
  for (const url of lanUrls()) console.log(`Other devices on your Wi‑Fi: ${url}`);
});
