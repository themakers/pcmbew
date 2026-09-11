import { createServer } from "node:http";
import { createServer as createIPC, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { unlinkSync, chmodSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import Ajv from "ajv";
import { Catalog } from "./catalog";
import { receive, send } from "./framing";
import { credential, equalSecret, PIPE } from "./local";
import { current, install, installInfo, latestVersion, newer } from "./installer";
import { VERSION, WIRE, PORT, TOOLS, BridgeError, failure, type Dict } from "./shared";

type Channel = { socket: Socket; ready: boolean; profile?: string; allowFocus: boolean; autoUpdate: boolean };
export async function broker() {
  const token = credential(), catalog = new Catalog();
  const channels = new Map<string, Channel>();
  const waiting = new Map<string, { channel: string; finish(value?: any, error?: any): void }>();
  const busy = new Set<string>();
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();
  const validator = new Ajv({ strict: false });
  const schemas = new Map(TOOLS.map(t => [t.name, validator.compile<Dict>(t.inputSchema)]));
  let updating = false, updateMessage = "", lastUse = Date.now(), refreshAt = 0;
  let refreshPending: Promise<void> | undefined;
  const status = () => ({ version: VERSION, connectedProfiles: [...channels.values()].filter(c => c.ready).length, enabledContexts: catalog.contexts().length, message: updateMessage });
  const broadcast = (m: any) => { for (const c of channels.values()) if (c.ready) { try { send(c.socket, m); } catch { c.socket.destroy(); } } };
  function rpc(channel: string, data: Dict, signal?: AbortSignal) {
    const c = channels.get(channel);
    if (!c?.ready || c.socket.destroyed) return Promise.reject(new BridgeError("browser_disconnected", "No browser connection; open the extension popup."));
    if (signal?.aborted) return Promise.reject(new BridgeError("cancelled", "Request already cancelled."));
    const id = randomUUID();
    return new Promise<any>((resolve, reject) => {
      let sent = false;
      const finish = (value?: any, error?: any) => { if (!waiting.delete(id)) return; clearTimeout(timer); signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(value); };
      const abort = () => { try { send(c.socket, { type: "cancel", id }); } catch {} finish(undefined, new BridgeError("cancelled", "Cancelled; inspect application state before retrying.", sent && data.op === "call" ? "unknown" : "not_started")); };
      const timer = setTimeout(abort, data.op === "refresh" ? 5000 : 125000);
      waiting.set(id, { channel, finish }); signal?.addEventListener("abort", abort, { once: true });
      try { send(c.socket, { type: "request", id, ...data }); sent = true; } catch (e) { finish(undefined, e); }
    });
  }
  async function refresh() {
    if (refreshPending) return refreshPending;
    if (Date.now() - refreshAt < 800) return;
    refreshPending = Promise.allSettled([...channels].filter(([, c]) => c.ready).map(([id]) => rpc(id, { op: "refresh" }))).then(() => { refreshAt = Date.now(); }).finally(() => { refreshPending = undefined; });
    return refreshPending;
  }
  async function execute(name: string, args: Dict, signal?: AbortSignal) {
    if (!schemas.get(name)?.(args)) throw new BridgeError("invalid_arguments", "Arguments do not match the bridge tool schema.");
    lastUse = Date.now();
    if (name === "webmcp_contexts") { await refresh(); return { bridge: status(), contexts: catalog.contexts() }; }
    if (name === "webmcp_search") { await refresh(); return catalog.search(args); }
    if (name === "webmcp_describe") { await refresh(); return catalog.describe(args.toolRefs); }
    if (updating) throw new BridgeError("updating", "Bridge is updating; rediscover after reconnecting.");
    const found = name === "webmcp_call" ? catalog.tool(args.toolRef) : undefined;
    const e = found?.entry ?? catalog.context(args.contextRef);
    if (busy.has(e.contextRef)) throw new BridgeError("context_busy", "Another call is running in this document; no request was queued.");
    if (busy.size >= 8) throw new BridgeError("busy", "Concurrent call limit reached; no request was queued.");
    if (name === "webmcp_focus" && !channels.get(e.channel)?.allowFocus) throw new BridgeError("focus_disabled", "Allow agent focus is disabled in the extension.");
    if (found) catalog.validate(args.toolRef, args.arguments);
    busy.add(e.contextRef);
    try {
      const result = await rpc(e.channel, { op: found ? "call" : "focus", key: e.page.key, revision: e.page.revision, toolKey: found?.tool.key, arguments: args.arguments }, signal);
      return { ...result, context: catalog.summary(e) };
    } finally { busy.delete(e.contextRef); }
  }
  function mcpServer() {
    const server = new Server({ name: "webmcp-bridge-ext", version: VERSION }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async (r, extra) => {
      try {
        const result = await execute(r.params.name, r.params.arguments ?? {}, extra.signal);
        const text = JSON.stringify(result); if (Buffer.byteLength(text) > 1024 * 1024) throw new BridgeError("result_too_large", "Ask for fewer tool descriptions or a smaller result.");
        return { content: [{ type: "text" as const, text }], structuredContent: result };
      } catch (e) { const error = failure(e); return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(error) }], structuredContent: { error } }; }
    });
    return server;
  }
  async function update(manual = false) {
    if (updating) return;
    if (busy.size) { updateMessage = "Update deferred: a website call is running."; broadcast({ type: "status", status: status() }); return; }
    if (!manual && (![...channels.values()].some(c => c.ready) || [...channels.values()].some(c => !c.autoUpdate))) return;
    updating = true;
    try {
      const version = await latestVersion(), old = current()?.version ?? VERSION;
      if (!newer(version, old)) { updateMessage = "Up to date."; return; }
      updateMessage = "Verifying update " + version + "..."; broadcast({ type: "status", status: status() });
      await install(version, undefined, installInfo()?.browser ?? "chrome");
      ipc.close(); broadcast({ type: "reload" }); setTimeout(shutdown, 800);
    } catch (e) { updateMessage = "Update refused: " + (e as Error).message; }
    finally { updating = false; broadcast({ type: "status", status: status() }); }
  }
  const ipc = createIPC(socket => {
    const id = randomUUID(), channel: Channel = { socket, ready: false, allowFocus: false, autoUpdate: false }; channels.set(id, channel);
    let authenticated = false;
    const deadline = setTimeout(() => socket.destroy(), 5000);
    receive(socket, m => {
      try {
        if (!authenticated) { if (m.type !== "authenticate" || !equalSecret(m.token, token)) throw new Error("Unauthenticated IPC"); authenticated = true; return; }
        if (m.type === "hello") {
          if (m.wire !== WIRE || typeof m.profile !== "string" || m.profile.length > 100) throw new Error("Incompatible native bridge");
          for (const [other, c] of channels) if (other !== id && c.profile === m.profile) c.socket.destroy();
          channel.ready = true; channel.profile = m.profile; channel.allowFocus = m.allowFocus === true; channel.autoUpdate = m.autoUpdate === true;
          clearTimeout(deadline); send(socket, { type: "welcome", status: status() }); return;
        }
        if (!channel.ready) throw new Error("Missing handshake");
        if (m.type === "context") catalog.upsert(id, m.page);
        if (m.type === "gone") catalog.remove(id, m.key);
        if (m.type === "policy") { channel.allowFocus = m.allowFocus === true; channel.autoUpdate = m.autoUpdate === true; }
        if (m.type === "update") void update(true);
        if (m.type === "response") { const p = waiting.get(m.id); if (p?.channel === id) p.finish(m.result, m.error ? new BridgeError(m.error.code, m.error.message, m.error.outcome) : undefined); }
      } catch { socket.destroy(); }
    }, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.on("close", () => { clearTimeout(deadline); channels.delete(id); catalog.remove(id); for (const p of waiting.values()) if (p.channel === id) p.finish(undefined, new BridgeError("browser_disconnected", "Browser disconnected during the operation; do not replay automatically.", "unknown")); });
  });
  const http = createServer((req, res) => { void (async () => {
    if (req.headers.host !== `127.0.0.1:${PORT}` || req.headers.origin !== undefined) { res.writeHead(403).end(); return; }
    if (!equalSecret(req.headers.authorization, "Bearer " + token)) { res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end(); return; }
    if (req.url === "/health" && req.method === "GET") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ name: "webmcp-bridge-ext", ...status() })); return; }
    if (req.url === "/admin/update" && req.method === "POST") { void update(true); res.writeHead(202).end(); return; }
    if (req.url === "/admin/stop" && req.method === "POST") { res.writeHead(202).end(); setTimeout(shutdown, 100); return; }
    if (req.url !== "/mcp") { res.writeHead(404).end(); return; }
    let body: any;
    if (req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json")) { res.writeHead(415).end(); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 192 * 1024) { res.writeHead(413).end(); return; } chunks.push(chunk); }
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { res.writeHead(400).end(); return; }
    }
    const sessionId = req.headers["mcp-session-id"];
    let session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (!session) {
      if (sessionId) { res.writeHead(404).end(); return; }
      if (req.method !== "POST" || !isInitializeRequest(body)) { res.writeHead(400).end(); return; }
      if (sessions.size >= 32) { res.writeHead(503).end(); return; }
      const server = mcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: id => { sessions.set(id, { transport, server }); } });
      transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
      await server.connect(transport); session = { transport, server };
    }
    lastUse = Date.now(); await session.transport.handleRequest(req, res, body);
  })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
  function shutdown() { for (const c of channels.values()) c.socket.destroy(); for (const s of sessions.values()) void s.server.close(); ipc.close(); http.close(); try { if (process.platform !== "win32") unlinkSync(PIPE); } catch {} setTimeout(() => process.exit(0), 200).unref(); }
  await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(PORT, "127.0.0.1", resolve); });
  // Owning 8777 is the singleton lease. Only its owner may remove a stale pipe.
  if (process.platform !== "win32") { try { unlinkSync(PIPE); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } }
  await new Promise<void>((resolve, reject) => { ipc.once("error", reject); ipc.listen(PIPE, () => { if (process.platform !== "win32") chmodSync(PIPE, 0o600); resolve(); }); });
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  setInterval(() => { if (!channels.size && !busy.size && Date.now() - lastUse > 120000) shutdown(); }, 30000).unref();
  setInterval(() => { void update(); }, 6 * 60 * 60 * 1000).unref();
  setTimeout(() => { void update(); }, 60000).unref();
  return { shutdown, catalog, status };
}
