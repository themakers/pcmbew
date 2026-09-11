const app = document.getElementById("app")!;
const isOptions = location.pathname.endsWith("options.html");
const port = chrome.runtime.connect({ name: "ui" });
const send = (op: string, values: object = {}) => port.postMessage({ op, ...values });
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = "") { const e = document.createElement(tag); e.textContent = text; e.className = cls; return e; }
function button(text: string, run: () => void | Promise<void>, cls = "") { const b = el("button", text, cls); b.onclick = () => { Promise.resolve(run()).catch(showError); }; return b; }
function check(text: string, value: boolean, run: (v: boolean) => void) { const label = el("label"); const c = el("input"); c.type = "checkbox"; c.checked = value; c.onchange = () => run(c.checked); label.append(c, el("span", text)); return label; }
function showError(e: unknown) { const p = el("p", String(e), "error"); app.prepend(p); }
async function grant(all: boolean) {
  let origins = ["http://*/*", "https://*/*"];
  if (!all) { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!/^https?:\/\//.test(tab?.url ?? "")) throw new Error("Open a website, then open this popup to scan it."); origins = [new URL(tab.url!).origin + "/*"]; }
  if (await chrome.permissions.request({ origins })) send("refresh");
}
port.onMessage.addListener(data => {
  if (data.uiError) { showError(data.uiError); return; }
  app.replaceChildren();
  const head = el("header"), titles = el("div"); titles.append(el("h1", "WebMCP Bridge"), el("p", "Your tabs. Your agent. Your permission.")); head.append(el("div", "W", "logo"), titles); app.append(head);
  const status = el("div", "", "status"); status.append(el("i", "", "dot" + (data.host.connected ? " live" : "")), el("span", data.host.connected ? "Native host connected" : "Waiting for native host"), el("small", ":8777")); app.append(status);
  if (data.host.message) app.append(el("p", data.host.message, "error"));
  if (!data.host.connected) app.append(el("p", "Ask your agent to run the install and doctor commands from this project's skill.", "muted"));
  if (data.host.activity) app.append(el("p", "Running: " + data.host.activity.tool, "pill"));
  for (const a of data.approvals) {
    const d = data.documents.find((d: any) => d.key === a.key), card = el("section", "", "card approval");
    card.append(el("div", "Approve website call", "title"), el("p", a.tool), el("small", d?.origin ?? "Context changed"), el("pre", JSON.stringify(a.arguments, null, 2).slice(0, 8192)));
    const actions = el("div", "", "actions"); actions.append(button("Allow once", () => send("approve", { id: a.id, yes: true }), "primary"), button("Deny", () => send("approve", { id: a.id, yes: false }))); card.append(actions); app.append(card);
  }
  app.append(el("h2", "WebMCP tabs"));
  const groups = new Map<string, any[]>();
  for (const d of data.documents) if (d.toolCount > 0) { const key = d.tabId + ":" + d.origin; groups.set(key, [...(groups.get(key) ?? []), d]); }
  for (const docs of groups.values()) {
    const d = docs[0], card = el("section", "", "card"), row = el("div", "", "row");
    const checkbox = check("", d.enabled, value => send("tab", { key: d.key, enabled: value })); checkbox.querySelector("input")!.setAttribute("aria-label", "Share " + d.title);
    const text = el("div", "", "grow"); const title = el("div", d.title || d.origin, "title"); title.title = d.title; text.append(title, el("div", d.origin + new URL(d.url).pathname, "url"), el("small", `${docs.reduce((n: number, v: any) => n + v.toolCount, 0)} tools${d.active ? " / active tab" : ""}${docs.every((v: any) => v.frameId !== 0) ? " / embedded document" : ""}`));
    row.append(checkbox, text, button("Focus", () => send("focus", { key: d.key }))); card.append(row);
    const site = el("div", "", "site"); site.append(check("Enable by default for this site", data.policy.sites[d.origin] === true, value => send("site", { origin: d.origin, enabled: value })));
    if (d.overridden) site.append(button("Use site default", () => send("tab", { key: d.key, inherit: true }), "text-button"));
    card.append(site); app.append(card);
  }
  if (!groups.size) { const empty = el("div", "", "empty"); empty.append(el("div", "No WebMCP tools discovered yet", "title"), el("p", "Allow scanning for a site you trust. Only native WebMCP tools are discovered; ordinary pages do not gain new tools.", "muted")); app.append(empty); }
  const actions = el("div", "", "actions"); actions.append(button("Scan current site", () => grant(false), "primary"), button("Allow scanning all sites", () => grant(true))); app.append(actions);
  app.append(el("h2", "Agent permissions"));
  const settings = el("section", "", "settings");
  settings.append(check("Allow agent to focus tabs", data.policy.allowFocus, value => send("setting", { name: "allowFocus", value })), check("Confirm each website call in popup", data.policy.confirmCalls, value => send("setting", { name: "confirmCalls", value })), check("Automatically install verified updates", data.policy.autoUpdate, value => send("setting", { name: "autoUpdate", value })));
  app.append(settings);
  if (isOptions) {
    app.append(el("h2", "Sites enabled by default"));
    for (const origin of Object.keys(data.policy.sites)) { const r = el("div", "", "row card"); r.append(el("span", origin, "grow"), button("Remove", () => send("site", { origin, enabled: false }))); app.append(r); }
    app.append(el("p", "Site defaults use exact origins, including scheme and port. Temporary tab overrides last until tab closure or cross-origin navigation. Stored locally in this Chrome profile; never synced.", "muted"));
    app.append(el("p", "Site access uses whichever account is currently signed in. Disable sharing before changing accounts. Updates affect this installation across Chrome profiles and wait for calls to finish.", "muted"));
    app.append(button("Revoke all scanning permissions", async () => { const p = await chrome.permissions.getAll(); await chrome.permissions.remove({ origins: p.origins ?? [] }); }));
  }
  const diagnostics = el("details"), summary = el("summary", "Diagnostics"); diagnostics.append(summary);
  for (const d of data.documents.filter((d: any) => d.status !== "ready")) diagnostics.append(el("p", `${d.origin}: ${d.detail ?? d.status}`, "muted"));
  diagnostics.append(button("Rescan permitted sites", () => send("refresh"))); app.append(diagnostics);
  const foot = el("footer"); foot.append(el("span", "v" + data.version), button("Check for updates", () => send("update")), button("Settings", () => chrome.runtime.openOptionsPage())); app.append(foot);
});
port.onDisconnect.addListener(() => showError("Extension reloaded. Reopen this popup."));
