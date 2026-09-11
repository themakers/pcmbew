#!/usr/bin/env node
import { parseArgs } from "node:util";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { VERSION, PORT, EXTENSION_ID } from "./shared";
import { HOME, credential } from "./local";
import { install, current, installedCLI, installInfo } from "./installer";
import { broker } from "./broker";
import { native } from "./connector";
import { stdio } from "./stdio";
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "native") { await native(rest[0]); return; }
  if (command === "broker") { await broker(); return; }
  if (command === "stdio") { await stdio(); return; }
  if (command === "install") {
    const { values } = parseArgs({ args: rest, options: { browser: { type: "string", default: "chrome" }, "local-archive": { type: "string" } } });
    console.log(JSON.stringify(await install(VERSION, values["local-archive"], values.browser), null, 2)); return;
  }
  if (command === "config") {
    console.log(JSON.stringify({ mcpServers: { "webmcp-bridge-ext": { command: process.execPath, args: [join(HOME, "runner.cjs"), "stdio"], env: { WEBMCP_HOME: HOME } } } }, null, 2)); return;
  }
  if (command === "doctor") {
    let health: any = { connected: false };
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`, { headers: { Authorization: "Bearer " + credential() }, signal: AbortSignal.timeout(2000) }); health = { status: r.status, ...(await r.json() as object) }; } catch {}
    console.log(JSON.stringify({ cliVersion: VERSION, installed: current() ?? null, nativeHost: installInfo() ?? null, extensionId: EXTENSION_ID, extensionDirectory: join(HOME, "extension"), credentialsPresent: existsSync(join(HOME, "auth.json")), endpoint: `http://127.0.0.1:${PORT}/mcp`, health }, null, 2)); return;
  }
  if (command === "update" || command === "stop") {
    const r = await fetch(`http://127.0.0.1:${PORT}/admin/${command}`, { method: "POST", headers: { Authorization: "Bearer " + credential() }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error("Host control failed: " + r.status); console.log(command + " requested"); return;
  }
  if (command === "--version") { console.log(VERSION); return; }
  if (!command || command === "--help") { console.log("webmcp-bridge-ext install [--browser chrome|chromium]\nwebmcp-bridge-ext config | doctor | stdio | update | stop\nInstall writes a per-user native host and prints the extension folder. Load that folder once using Chrome's extension manager. No website library is needed."); return; }
  throw new Error("Unknown command. Use --help.");
}
main().catch(e => { console.error("webmcp-bridge-ext:", (e as Error).message); process.exit(1); });
