import { randomUUID, createHash } from "node:crypto";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { BridgeError, clean, safeURL, type Page, type Tool } from "./shared";
type Entry = { channel: string; page: Page; contextRef: string; refs: Map<string, Tool>; touched: number };
const reject = (reason: string): never => { console.error("Rejected WebMCP catalogue:", reason); throw new Error(reason); };
export class Catalog {
  entries = new Map<string, Entry>();
  private validators = new Map<string, (args: unknown) => boolean>();
  private revision = 0;
  private ajv = new Ajv({ strict: false, validateFormats: false, ownProperties: true, addUsedSchema: false });
  private modern = new Ajv2020({ strict: false, validateFormats: false, ownProperties: true, addUsedSchema: false });
  upsert(channel: string, input: Page) {
    const p: Page = structuredClone(input);
    if (!p || typeof p.key !== "string" || typeof p.documentId !== "string" || typeof p.title !== "string" || !Number.isInteger(p.tabId) || !Number.isInteger(p.frameId) || !Number.isInteger(p.revision) || typeof p.enabled !== "boolean" || !Array.isArray(p.tools) || p.tools.length > 128) reject("Invalid context field types: " + JSON.stringify(Object.fromEntries(["key", "documentId", "title", "tabId", "frameId", "revision", "enabled", "tools"].map(k => [k, typeof (p as any)?.[k]]))));
    const u = new URL(p.url);
    if (!["http:", "https:"].includes(u.protocol) || u.origin !== p.origin) reject("Invalid origin");
    p.url = safeURL(p.url); p.title = clean(p.title);
    const keys = new Set();
    for (const t of p.tools) {
      if (typeof t.key !== "string" || keys.has(t.key) || typeof t.name !== "string" || typeof t.description !== "string" || !t.inputSchema || Array.isArray(t.inputSchema) || typeof t.inputSchema !== "object") reject("Invalid tool field types: " + JSON.stringify({ key: typeof t.key, duplicateKey: keys.has(t.key), name: typeof t.name, description: typeof t.description, inputSchema: typeof t.inputSchema }));
      keys.add(t.key);
    }
    const key = channel + ":" + p.key, old = this.entries.get(key);
    const changed = !old || old.page.documentId !== p.documentId || old.page.origin !== p.origin || old.page.revision !== p.revision || old.page.enabled !== p.enabled || JSON.stringify(old.page.tools) !== JSON.stringify(p.tools);
    if (!old && this.entries.size >= 256) reject("Context limit exceeded");
    if (changed) {
      if (old) for (const r of old.refs.keys()) this.validators.delete(r);
      this.entries.set(key, { channel, page: p, touched: Date.now(), contextRef: "ctx_" + randomUUID(), refs: new Map(p.tools.map(t => ["tool_" + randomUUID(), t])) });
      this.revision++;
    } else {
      if (old.page.url !== p.url || old.page.title !== p.title) this.revision++;
      old.page = p; old.touched = Date.now();
    }
  }
  remove(channel: string, pageKey?: string) {
    for (const [key, e] of this.entries) if (e.channel === channel && (!pageKey || e.page.key === pageKey)) { for (const r of e.refs.keys()) this.validators.delete(r); this.entries.delete(key); this.revision++; }
  }
  private visible(e: Entry) { return e.page.enabled && e.page.tools.length > 0 && Date.now() - e.touched < 60000; }
  summary(e: Entry) { const p = e.page; return { contextRef: e.contextRef, origin: p.origin, url: p.url, title: p.title, active: p.active, frameId: p.frameId, toolCount: p.tools.length }; }
  contexts() { return [...this.entries.values()].filter(e => this.visible(e)).map(e => this.summary(e)); }
  context(ref: string) {
    const e = [...this.entries.values()].find(e => e.contextRef === ref);
    if (!e) throw new BridgeError("stale_context", "Rediscover contexts; this reference expired.");
    if (!this.visible(e)) throw new BridgeError("context_disabled", "Context disabled, expired or disconnected.");
    return e;
  }
  tool(ref: string) {
    for (const e of this.entries.values()) if (e.refs.has(ref)) { this.context(e.contextRef); return { entry: e, tool: e.refs.get(ref)! }; }
    throw new BridgeError("stale_tool", "Rediscover and describe the tool; this reference expired.");
  }
  search({ query = "", contextRef, limit = 20, cursor }: { query?: string; contextRef?: string; limit?: number; cursor?: string }) {
    if (contextRef) this.context(contextRef);
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = [...this.entries.values()].filter(e => this.visible(e) && (!contextRef || e.contextRef === contextRef)).flatMap(e => [...e.refs].map(([toolRef, t]) => ({ toolRef, name: clean(t.name), description: clean(t.description, 240), context: this.summary(e) })));
    const matches = rows.filter(r => words.every(w => (r.name + " " + r.description + " " + r.context.origin + " " + r.context.title).toLowerCase().includes(w)));
    const signature = createHash("sha256").update(JSON.stringify([query, contextRef, this.revision, matches.map(r => r.toolRef)])).digest("hex").slice(0, 24);
    let offset = 0;
    if (cursor) { const [s, n] = cursor.split("."); if (s !== signature || !/^\d+$/.test(n ?? "")) throw new BridgeError("stale_catalog", "Restart search without a cursor."); offset = Number(n); }
    return { tools: matches.slice(offset, offset + limit), nextCursor: offset + limit < matches.length ? `${signature}.${offset + limit}` : undefined };
  }
  describe(refs: string[]) { return { tools: refs.map(toolRef => { const { entry, tool: { key, ...tool } } = this.tool(toolRef); return { toolRef, ...tool, context: this.summary(entry) }; }) }; }
  validate(ref: string, args: unknown) {
    const { tool } = this.tool(ref); let validate = this.validators.get(ref);
    if (!validate) {
      try { validate = (String(tool.inputSchema.$schema).includes("2020-12") ? this.modern : this.ajv).compile(tool.inputSchema) as (a: unknown) => boolean; }
      catch { throw new BridgeError("unsupported_schema", "Unsupported schema; external references are never fetched."); }
      this.validators.set(ref, validate);
    }
    if (!validate(args)) throw new BridgeError("invalid_arguments", "Arguments do not match the discovered input schema.");
  }
}
