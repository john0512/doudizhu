import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function acceptKey(key) {
  return createHash("sha1").update(key + GUID).digest("base64");
}

export function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = buf[1] & 0x80;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buf.length < offset + len) return null;
  let payload = buf.subarray(offset, offset + len);
  if (masked) {
    const mask = buf.subarray(maskOffset, maskOffset + 4);
    payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  }
  return { opcode, payload, rest: buf.subarray(offset + len) };
}

export function encodeFrame(opcode, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

export function attachWebSocket(socket, onMessage, onClose) {
  let buffer = Buffer.alloc(0);
  let closed = false;
  const send = (obj) => {
    if (closed) return;
    try {
      socket.write(encodeFrame(0x1, JSON.stringify(obj)));
    } catch {
      closer();
    }
  };
  const closer = () => {
    if (closed) return;
    closed = true;
    clearInterval(pingTimer);
    try {
      socket.end();
    } catch {
      /* ignore */
    }
    onClose();
  };
  const pingTimer = setInterval(() => {
    if (closed) return;
    try {
      socket.write(encodeFrame(0x9, Buffer.alloc(0)));
    } catch {
      closer();
    }
  }, 20000);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let frame = decodeFrame(buffer);
    while (frame) {
      buffer = frame.rest;
      if (frame.opcode === 0x8) {
        closer();
        return;
      }
      if (frame.opcode === 0x9) {
        try {
          socket.write(encodeFrame(0xa, frame.payload));
        } catch {
          closer();
          return;
        }
      }
      if (frame.opcode === 0x1) {
        let msg;
        try {
          msg = JSON.parse(frame.payload.toString("utf8"));
        } catch {
          send({ type: "error", message: "Bad message" });
          frame = decodeFrame(buffer);
          continue;
        }
        try {
          onMessage(msg);
        } catch (err) {
          send({ type: "error", message: err.message || "Server error" });
        }
      }
      frame = decodeFrame(buffer);
    }
  });
  socket.on("close", closer);
  socket.on("error", () => closer());
  return { send, closer };
}
