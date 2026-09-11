import { HOST, VERSION, WIRE, DEFAULT_POLICY, enabled, failure, BridgeError, safeURL, type Policy, type Page } from "../src/shared";
type Entry = { page: Page; port: chrome.runtime.Port; status: string; detail?: string };
let policy: Policy = structuredClone(DEFAULT_POLICY), profile = "";
let overrides: Record<string, { origin: string; enabled: boolean }> = {};
let native: chrome.runtime.Port | undefined;
let host: any = { connected: false, message: "Native host not connected" };
const docs = new Map<string, Entry>(), ui = new Set<chrome.runtime.Port>();
const pending = new Map<string, { key: string; resolve(v: any): void; reject(e: any): void; timer: ReturnType<typeof setTimeout> }>();
const approvals = new Map<string, { key: string; tool: string; arguments: any; resolve(v: boolean): void; timer: ReturnType<typeof setTimeout> }>();
const boot = (async () => {
  const data = await chrome.storage.local.get(["policy", "profile"]) as { policy?: Partial<Policy>; profile?: string };
  policy = { ...DEFAULT_POLICY, ...data.policy, sites: { ...(data.policy?.sites ?? {}) } };
  profile = data.profile || crypto.randomUUID();
  if (!data.profile) await chrome.storage.local.set({ profile });
  overrides = ((await chrome.storage.session.get("overrides")).overrides ?? {}) as typeof overrides;
})();
const overrideKey = (p: Page) => `${p.tabId}:${p.origin}`;
const exposed = (p: Page) => enabled(policy, overrides[overrideKey(p)], p.origin);
function send(m: any) { try { native?.postMessage(m); } catch { host.connected = false; } }
function snapshot(d: Entry) { d.page.enabled = exposed(d.page); send({ type: "context", page: d.page }); }
function project() {
  const data = { version: VERSION, host, policy, documents: [...docs.values()].map(d => ({ ...d.page, tools: undefined, toolCount: d.page.tools.length, enabled: exposed(d.page), overridden: overrideKey(d.page) in overrides, status: d.status, detail: d.detail })), approvals: [...approvals].map(([id, a]) => ({ id, key: a.key, tool: a.tool, arguments: a.arguments })) };
  for (const p of ui) { try { p.postMessage(data); } catch { ui.delete(p); } }
  void chrome.action.setBadgeText({ text: approvals.size ? "!" : String([...docs.values()].filter(d => exposed(d.page) && d.page.tools.length).length).replace(/^0$/, "") });
  void chrome.action.setBadgeBackgroundColor({ color: approvals.size ? "#B45309" : "#147D64" });
}
function decide(id: string, yes: boolean) { const a = approvals.get(id); if (a) { clearTimeout(a.timer); approvals.delete(id); a.resolve(yes); project(); } }
function cancel(id: string) {
  decide(id, false); const p = pending.get(id); if (!p) return;
  try { docs.get(p.key)?.port.postMessage({ op: "cancel", id }); } catch {}
  clearTimeout(p.timer); pending.delete(id); p.reject(new BridgeError("cancelled", "Execution cancelled; outcome may be unknown.", "unknown"));
}
function remove(key: string) {
  for (const [id, p] of pending) if (p.key === key) cancel(id);
  for (const [id, a] of approvals) if (a.key === key) decide(id, false);
  docs.delete(key); send({ type: "gone", key }); project();
}
function connect() {
  if (native) return;
  try {
    native = chrome.runtime.connectNative(HOST);
    native.onMessage.addListener(m => { void fromHost(m).catch(e => { host.message = String(e); project(); }); });
    native.onDisconnect.addListener(() => {
      host = { connected: false, message: chrome.runtime.lastError?.message ?? "Native host disconnected" }; native = undefined;
      for (const id of [...approvals.keys(), ...pending.keys()]) cancel(id);
      project(); void chrome.alarms.create("retry", { delayInMinutes: 0.5 });
    });
    send({ type: "hello", wire: WIRE, version: VERSION, profile, allowFocus: policy.allowFocus, autoUpdate: policy.autoUpdate });
  } catch (e) { host = { connected: false, message: String(e) }; project(); }
}
function pageRequest(d: Entry, m: any, timeout: number) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => cancel(m.id), timeout);
    pending.set(m.id, { key: d.page.key, resolve, reject, timer });
    try { d.port.postMessage(m); } catch { cancel(m.id); }
  });
}
async function focus(tabId: number) { const t = await chrome.tabs.update(tabId, { active: true }); if (!t) throw new BridgeError("stale_context", "Tab closed before focus."); if (t.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true }); }
async function fromHost(m: any) {
  await boot;
  if (m.type === "welcome") { host = { connected: true, ...m.status }; for (const d of docs.values()) snapshot(d); project(); return; }
  if (m.type === "status") { host = { ...host, ...m.status }; project(); return; }
  if (m.type === "reload") { chrome.runtime.reload(); return; }
  if (m.type === "cancel") { cancel(m.id); return; }
  if (m.type !== "request") return;
  try {
    let result: any;
    if (m.op === "refresh") {
      await Promise.allSettled([...docs.values()].map(d => pageRequest(d, { op: "refresh", id: crypto.randomUUID() }, 3000)));
      for (const d of docs.values()) snapshot(d); result = { refreshed: true };
    } else {
      const d = docs.get(m.key);
      if (!d || !exposed(d.page)) throw new BridgeError("context_disabled", "This context is no longer enabled.");
      if (m.op === "focus") {
        if (!policy.allowFocus) throw new BridgeError("focus_disabled", "Enable Allow agent focus in the popup.");
        await focus(d.page.tabId); result = { focused: true };
      } else if (m.op === "call") {
        const t = d.page.tools.find(t => t.key === m.toolKey);
        if (!t || d.page.revision !== m.revision) throw new BridgeError("stale_tool", "Rediscover the tool.");
        if (policy.confirmCalls) {
          const yes = await new Promise<boolean>(resolve => { const timer = setTimeout(() => decide(m.id, false), 55000); approvals.set(m.id, { key: m.key, tool: t.name, arguments: m.arguments, resolve, timer }); project(); });
          if (!yes) throw new BridgeError("approval_denied", "Popup approval denied, cancelled or expired.");
        }
        if (docs.get(m.key) !== d || !exposed(d.page) || d.page.revision !== m.revision) throw new BridgeError("stale_context", "Context changed while awaiting approval.");
        host.activity = { key: m.key, tool: t.name }; project();
        result = await pageRequest(d, { op: "call", id: m.id, toolKey: m.toolKey, revision: m.revision, arguments: m.arguments }, 60000);
      } else throw new BridgeError("invalid_request", "Unknown bridge operation.");
    }
    send({ type: "response", id: m.id, result });
  } catch (e) { send({ type: "response", id: m.id, error: failure(e) }); }
  host.activity = undefined; project();
}
chrome.runtime.onConnect.addListener(port => {
  if (port.sender?.id !== chrome.runtime.id) return;
  if (port.name === "ui" && [chrome.runtime.getURL("popup.html"), chrome.runtime.getURL("options.html")].includes(port.sender.url ?? "")) {
    ui.add(port); port.onDisconnect.addListener(() => ui.delete(port));
    port.onMessage.addListener(m => { void uiMessage(m).catch(e => port.postMessage({ uiError: String(e) })); });
    void boot.then(() => { connect(); project(); }); return;
  }
  if (port.name !== "webmcp-document" || port.sender.tab?.id === undefined || port.sender.tab.incognito || !port.sender.documentId || !/^https?:\/\//.test(port.sender.url ?? "")) return;
  const s = port.sender, url = s.url!, key = crypto.randomUUID();
  const page: Page = { key, documentId: s.documentId!, tabId: s.tab!.id!, frameId: s.frameId ?? 0, origin: new URL(url).origin, url: safeURL(url), title: s.tab!.title ?? "", active: s.tab!.active, enabled: false, revision: 0, tools: [] };
  const d: Entry = { page, port, status: "checking" }; docs.set(key, d);
  port.onDisconnect.addListener(() => remove(key));
  port.onMessage.addListener(m => { void boot.then(() => {
    if (!docs.has(key)) return;
    if (m.type === "snapshot" && Array.isArray(m.tools) && m.tools.length <= 128 && Number.isInteger(m.revision)) {
      page.tools = m.tools; page.revision = m.revision; d.status = m.status; d.detail = m.detail; snapshot(d); project();
    } else if (m.type === "response") {
      const p = pending.get(m.id); if (!p || p.key !== key) return;
      clearTimeout(p.timer); pending.delete(m.id);
      m.error ? p.reject(new BridgeError(m.error.code ?? "tool_error", m.error.message ?? "Page error", m.error.outcome ?? "unknown")) : p.resolve(m.result);
    }
  }); });
  void boot.then(connect);
});
async function uiMessage(m: any) {
  await boot;
  if (m.op === "refresh") { connect(); await register(); project(); return; }
  if (m.op === "focus") { const d = docs.get(m.key); if (d) await focus(d.page.tabId); return; }
  if (m.op === "approve") { decide(m.id, m.yes === true); return; }
  if (m.op === "update") { send({ type: "update" }); return; }
  if (m.op === "tab") { const d = docs.get(m.key); if (!d) return; if (m.inherit) delete overrides[overrideKey(d.page)]; else overrides[overrideKey(d.page)] = { origin: d.page.origin, enabled: m.enabled === true }; await chrome.storage.session.set({ overrides }); }
  else if (m.op === "site") { const u = new URL(m.origin); if (u.origin !== m.origin || !/^https?:$/.test(u.protocol)) return; if (m.enabled) policy.sites[u.origin] = true; else delete policy.sites[u.origin]; await chrome.storage.local.set({ policy }); }
  else if (m.op === "setting" && ["allowFocus", "confirmCalls", "autoUpdate"].includes(m.name)) { (policy as any)[m.name] = m.value === true; await chrome.storage.local.set({ policy }); }
  for (const d of docs.values()) {
    snapshot(d);
    if (!exposed(d.page)) for (const [id, p] of [...pending, ...approvals]) if (p.key === d.page.key) cancel(id);
  }
  send({ type: "policy", allowFocus: policy.allowFocus, autoUpdate: policy.autoUpdate }); project();
}
let registration = Promise.resolve();
function register() {
  registration = registration.then(async () => {
    const origins = (await chrome.permissions.getAll()).origins?.filter(x => /^https?:/.test(x)) ?? [];
    await chrome.scripting.unregisterContentScripts();
    if (!origins.length) return;
    await chrome.scripting.registerContentScripts([{ id: "webmcp", js: ["content.js"], matches: origins, allFrames: true, runAt: "document_idle", persistAcrossSessions: true }]);
    for (const t of await chrome.tabs.query({})) if (t.id && !t.incognito && /^https?:/.test(t.url ?? "")) {
      if (await chrome.permissions.contains({ origins: [new URL(t.url!).origin + "/*"] })) await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ["content.js"] }).catch(() => {});
    }
  }).catch(e => { host.message = String(e); project(); }); return registration;
}
chrome.permissions.onAdded.addListener(() => { void boot.then(register); });
chrome.permissions.onRemoved.addListener(() => { for (const [k, d] of docs) { d.port.disconnect(); remove(k); } void boot.then(register); });
chrome.runtime.onInstalled.addListener(() => { void boot.then(async () => { await register(); connect(); }); });
chrome.runtime.onStartup.addListener(() => { void boot.then(async () => { overrides = {}; await chrome.storage.session.set({ overrides }); await register(); connect(); }); });
chrome.alarms.onAlarm.addListener(() => { void boot.then(connect); });
chrome.tabs.onRemoved.addListener(id => { for (const [k, d] of docs) if (d.page.tabId === id) remove(k); for (const k of Object.keys(overrides)) if (k.startsWith(id + ":")) delete overrides[k]; void chrome.storage.session.set({ overrides }); });
chrome.tabs.onActivated.addListener(({ tabId }) => { for (const d of docs.values()) { d.page.active = d.page.tabId === tabId; snapshot(d); } project(); });
chrome.tabs.onUpdated.addListener((tabId, change) => { for (const d of docs.values()) if (d.page.tabId === tabId && change.title) { d.page.title = change.title; snapshot(d); } project(); });
chrome.webNavigation.onCommitted.addListener(nav => {
  for (const [k, d] of docs) if (d.page.tabId === nav.tabId && (nav.frameId === 0 || nav.frameId === d.page.frameId) && d.page.documentId !== nav.documentId) remove(k);
  if (nav.frameId === 0) { const origin = new URL(nav.url).origin; for (const k of Object.keys(overrides)) if (k.startsWith(nav.tabId + ":") && overrides[k].origin !== origin) delete overrides[k]; void chrome.storage.session.set({ overrides }); }
});
chrome.webNavigation.onHistoryStateUpdated.addListener(nav => { for (const d of docs.values()) if (d.page.tabId === nav.tabId && d.page.frameId === nav.frameId && new URL(nav.url).origin === d.page.origin) { d.page.url = safeURL(nav.url); snapshot(d); } project(); });
void boot.then(connect);
