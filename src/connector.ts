import { connect, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { PIPE, HOME, credential } from "./local";
import { installedCLI } from "./installer";
import { send, receive } from "./framing";
import { EXTENSION_ID } from "./shared";
export async function connectBroker(): Promise<Socket> {
  const token = credential(); let spawned = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const socket = await new Promise<Socket>((resolve, reject) => { const s = connect(PIPE); s.once("connect", () => { s.off("error", reject); resolve(s); }); s.once("error", reject); });
      send(socket, { type: "authenticate", token }); return socket;
    } catch (e) {
      if (!["ENOENT", "ECONNREFUSED"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
      if (!spawned || attempt % 10 === 0) { const log = openSync(join(HOME, "broker.log"), "a", 0o600); const child = spawn(process.execPath, [installedCLI(), "broker"], { detached: true, stdio: ["ignore", "ignore", log], env: { ...process.env, WEBMCP_HOME: HOME } }); child.on("error", () => {}); child.unref(); closeSync(log); spawned = true; }
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw new Error("Broker unavailable on 8777. Check doctor/broker.log; the port is never changed automatically.");
}
export async function native(origin: string) {
  if (origin !== `chrome-extension://${EXTENSION_ID}/`) throw new Error("Unexpected native messaging origin");
  const socket = await connectBroker();
  const end = () => { socket.destroy(); process.exit(0); };
  receive(process.stdin, m => { try { send(socket, m); } catch { end(); } }, end);
  receive(socket, m => { try { send(process.stdout, m); } catch { end(); } }, end);
  socket.on("close", end); socket.on("error", end); process.stdin.on("end", end); process.stdout.on("error", end);
}
