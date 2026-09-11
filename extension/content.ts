import { VERSION, MAX_RESULT } from "../src/shared";
type NativeTool = { name: string; description: string; title?: string; inputSchema?: object | string; annotations?: object; window: Window; origin: string };
type ModelContext = EventTarget & { getTools(): Promise<NativeTool[]>; executeTool(tool: NativeTool, args: unknown, options?: { signal: AbortSignal }): Promise<string | null> };
// Runs in Chrome's isolated world. No eval, MAIN-world injection, cookie access,
// DOM scraping, or page postMessage command channel.
const guard = Symbol.for("webmcp-bridge-ext.content");
(globalThis as any)[guard]?.stop();
let stopped = false, revision = 0, fingerprint = "", paused = false;
let port: chrome.runtime.Port | undefined, context: ModelContext | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let serial = Promise.resolve();
let registry = new Map<string, NativeTool>();
const calls = new Map<string, AbortController>();
const emit = (m: any) => { try { port?.postMessage(m); } catch { /* reconnect below */ } };
function descriptor(t: NativeTool) {
  // Chrome 153 serializes schemas and execution arguments as JSON strings;
  // the later native API uses objects. Never retry a call to probe the API.
  const schema = typeof t.inputSchema === "string" ? JSON.parse(t.inputSchema) : t.inputSchema ?? { type: "object", properties: {} };
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("Invalid native tool input schema.");
  return { name: t.name, description: t.description, title: t.title, inputSchema: schema, annotations: t.annotations };
}
const own = (items: NativeTool[]) => items.filter(t => t.window === window && t.origin === location.origin).sort((a, b) => a.name.localeCompare(b.name));
function invalidate() { revision++; registry.clear(); fingerprint = ""; for (const c of calls.values()) c.abort(); }
function snapshot(status: string, detail?: string) {
  emit({ type: "snapshot", revision, status, detail, tools: [...registry].map(([key, t]) => ({ key, ...descriptor(t) })) });
}
async function scan() {
  if (stopped || paused) return;
  const next = (document as any).modelContext as ModelContext | undefined;
  if (!next || typeof next.getTools !== "function" || typeof next.executeTool !== "function") {
    if (registry.size) invalidate(); snapshot("unsupported", "This document does not expose native document.modelContext.getTools/executeTool."); return;
  }
  if (context !== next) { context?.removeEventListener("toolchange", changed); context = next; context.addEventListener("toolchange", changed); invalidate(); }
  const list = own(await context.getTools());
  if (stopped || paused) return;
  if (list.length > 128) throw new Error("Document exceeds 128 tools.");
  const encoded = JSON.stringify(list.map(descriptor));
  if (new TextEncoder().encode(encoded).length > 256 * 1024) throw new Error("Tool catalogue exceeds 256 KiB.");
  if (fingerprint !== encoded) { revision++; registry = new Map(list.map(t => [crypto.randomUUID(), t])); fingerprint = encoded; }
  else { const fresh = new Map(list.map(t => [t.name, t])); for (const [key, t] of registry) registry.set(key, fresh.get(t.name)!); }
  snapshot("ready");
}
function refresh() {
  serial = serial.then(scan).catch(e => { invalidate(); snapshot("error", String(e).slice(0, 300)); });
  return serial;
}
function changed() { invalidate(); snapshot("checking"); void refresh(); }
async function request(m: any) {
  if (m.op === "cancel") { calls.get(m.id)?.abort(); return; }
  if (m.op === "refresh") { await refresh(); emit({ type: "response", id: m.id, result: { refreshed: true } }); return; }
  if (m.op !== "call" || typeof m.id !== "string") return;
  const controller = new AbortController(); calls.set(m.id, controller);
  let started = false;
  try {
    await serial;
    const t = registry.get(m.toolKey), expected = revision;
    if (!t || !context || paused || m.revision !== revision) throw new Error("Rediscover: stale tool.");
    const fresh = own(await context.getTools()).find(x => x.name === t.name);
    if (!fresh || revision !== expected || JSON.stringify(descriptor(fresh)) !== JSON.stringify(descriptor(t))) throw new Error("Rediscover: tool definition changed.");
    const args = typeof fresh.inputSchema === "string" ? JSON.stringify(m.arguments) : m.arguments;
    controller.signal.throwIfAborted(); started = true;
    const value = await context.executeTool(fresh, args, { signal: controller.signal });
    if (value === null) throw new Error("No completion result: document may have navigated. Inspect state before retrying.");
    if (typeof value !== "string" || new TextEncoder().encode(value).length > MAX_RESULT) throw new Error("Result exceeds 384 KiB or is invalid; narrow the operation.");
    emit({ type: "response", id: m.id, result: { value } });
  } catch (e) {
    emit({ type: "response", id: m.id, error: { code: !started ? "stale_tool" : (e as Error).name === "NotAllowedError" ? "needs_user_activation" : "tool_error", message: String(e).slice(0, 500), outcome: started ? "unknown" : "not_started" } });
  } finally { calls.delete(m.id); }
}
function connect() {
  if (stopped) return;
  try {
    port = chrome.runtime.connect({ name: "webmcp-document" });
    port.onMessage.addListener(m => { void request(m); });
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; port = undefined; if (!stopped) retry = setTimeout(connect, 1500); });
    void refresh();
  } catch { if (!stopped) retry = setTimeout(connect, 3000); }
}
const hidden = () => { paused = true; invalidate(); snapshot("suspended"); };
const shown = () => { paused = false; void refresh(); };
window.addEventListener("pagehide", hidden); window.addEventListener("pageshow", shown);
const timer = setInterval(() => { void refresh(); }, 20000);
(globalThis as any)[guard] = { version: VERSION, stop() { stopped = true; invalidate(); clearInterval(timer); clearTimeout(retry); context?.removeEventListener("toolchange", changed); window.removeEventListener("pagehide", hidden); window.removeEventListener("pageshow", shown); port?.disconnect(); } };
connect();
