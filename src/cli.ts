#!/usr/bin/env node
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const die = (error: unknown): never => {
  console.error("pcmbew:", error instanceof Error ? error.message : error);
  process.exit(1);
};

const { values } = parseArgs({ options: {
  port: { type: "string" }, origin: { type: "string" }, help: { type: "boolean" },
} });

if (values.help) {
  console.error("pcmbew --port <1..65535> [--origin https://your-spa.example]");
  process.exit(0);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) die("--port must be 1..65535");
let origin = values.origin;
if (origin && (!/^https?:\/\//.test(origin) || new URL(origin).origin !== origin)) {
  die("--origin must be an HTTP(S) origin, without a path or trailing slash");
}

let browser: WebSocket | undefined;
const pending: string[] = [];
const limit = 8 * 1024 * 1024;
let pendingBytes = 0;

const server = new WebSocketServer({
  host: "127.0.0.1", port, maxPayload: limit, perMessageDeflate: false,
  verifyClient: ({ origin: incoming, req }: { origin: string; req: IncomingMessage }) =>
    req.headers.host === `127.0.0.1:${port}` &&
    /^https?:\/\//.test(incoming) && (!origin || origin === incoming) && !browser,
});

server.on("error", die);
server.on("listening", () => console.error(`pcmbew: ws://127.0.0.1:${port}`));

const send = (socket: WebSocket, line: string) => {
  if (socket.bufferedAmount + Buffer.byteLength(line) > limit) die("browser is too slow");
  socket.send(line, error => { if (error) socket.terminate(); });
};

server.on("connection", (socket, request) => {
  browser = socket;
  origin ??= request.headers.origin;
  socket.on("error", () => socket.terminate());
  socket.on("close", () => { if (browser === socket) browser = undefined; });
  socket.on("message", (data, binary) => {
    if (browser !== socket) return;
    const line = data.toString();
    if (binary || /[\r\n]/.test(line)) { socket.close(1003, "One text line per frame"); return; }
    if (!process.stdout.write(line + "\n")) {
      socket.pause();
      process.stdout.once("drain", () => socket.resume());
    }
  });
  for (const line of pending) send(socket, line);
  pending.length = pendingBytes = 0;
});

const input = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
input.on("line", line => {
  if (browser?.readyState === WebSocket.OPEN) send(browser, line);
  else {
    pendingBytes += Buffer.byteLength(line) + 1;
    if (pendingBytes > limit) die("offline input buffer exceeded 8 MiB");
    pending.push(line);
  }
});
input.on("close", () => process.exit(0));
process.stdout.on("error", die);
