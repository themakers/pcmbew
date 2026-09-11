import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect, type Socket } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { encode, Decoder } from "../src/framing";
import { WIRE, VERSION, TOOLS, type Page } from "../src/shared";
import { createHash } from "node:crypto";
test("real MCP HTTP + authenticated native IPC + stable discovery/call/revocation", async () => {
  const home = mkdtempSync(join(tmpdir(), "webmcp-broker-")), token = "a".repeat(64);
  writeFileSync(join(home, "auth.json"), JSON.stringify({ token }));
  const child = Bun.spawn([process.execPath, resolve("dist/cli.js"), "broker"], { env: { ...process.env, WEBMCP_HOME: home }, stdout: "ignore", stderr: "pipe" });
  let socket: Socket | undefined; const client = new Client({ name: "integration-test", version: "1" });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) { try { const r = await fetch("http://127.0.0.1:8777/health", { headers: { Authorization: "Bearer " + token } }); if (r.ok) { ready = true; break; } } catch {} await Bun.sleep(100); }
    expect(ready).toBe(true);
    expect((await fetch("http://127.0.0.1:8777/health")).status).toBe(401);
    expect((await fetch("http://127.0.0.1:8777/health", { headers: { Authorization: "Bearer " + token, Origin: "https://evil.example" } })).status).toBe(403);
    const pipe = process.platform === "win32" ? "\\\\.\\pipe\\webmcp-bridge-" + createHash("sha256").update(home).digest("hex").slice(0, 20) : join(home, "broker.sock");
    socket = await new Promise<Socket>((r, reject) => { const s = connect(pipe); s.once("connect", () => r(s)); s.once("error", reject); });
    const page: Page = { key: "p", documentId: "d", tabId: 8, frameId: 0, origin: "https://example.com", url: "https://example.com/", title: "Test", active: true, enabled: true, revision: 1, tools: [{ key: "echo", name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] };
    socket.write(encode({ type: "authenticate", token })); socket.write(encode({ type: "hello", wire: WIRE, version: VERSION, profile: "test", allowFocus: false, autoUpdate: false })); socket.write(encode({ type: "context", page }));
    let calls = 0; const decoder = new Decoder();
    socket.on("data", data => { for (const m of decoder.push(data)) if (m.type === "request") { if (m.op === "call") calls++; socket!.write(encode({ type: "response", id: m.id, result: m.op === "call" ? { value: m.arguments.text } : { refreshed: true } })); } });
    await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8777/mcp"), { requestInit: { headers: { Authorization: "Bearer " + token } } }));
    const first = await client.listTools(); expect(first.tools.map(t => t.name)).toEqual(TOOLS.map(t => t.name));
    const call = async (name: string, args: any = {}) => client.callTool({ name, arguments: args });
    const search: any = await call("webmcp_search", {}); const ref = search.structuredContent.tools[0].toolRef;
    const result: any = await call("webmcp_call", { toolRef: ref, arguments: { text: "ok" } }); expect(result.structuredContent.value).toBe("ok"); expect(calls).toBe(1);
    const contexts: any = await call("webmcp_contexts");
    const focus: any = await call("webmcp_focus", { contextRef: contexts.structuredContent.contexts[0].contextRef }); expect(focus.isError).toBe(true); expect(focus.structuredContent.error.code).toBe("focus_disabled");
    page.enabled = false; socket.write(encode({ type: "context", page })); await Bun.sleep(100);
    expect((await call("webmcp_call", { toolRef: ref, arguments: { text: "never" } })).isError).toBe(true); expect(calls).toBe(1);
    expect((await client.listTools()).tools).toEqual(first.tools);
  } finally { await client.close().catch(() => {}); socket?.destroy(); child.kill(); await child.exited; rmSync(home, { recursive: true, force: true }); }
}, 20000);
