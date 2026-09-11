import { test, expect } from "bun:test";
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EXTENSION_ID } from "../src/shared";
test("Chrome popup, persistent policy, native host and native WebMCP", async () => {
  const home = mkdtempSync(join(tmpdir(), "webmcp-browser-")), data = join(home, "bridge"), userDataDir = join(home, "profile");
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), WEBMCP_HOME: data };
  const install = Bun.spawnSync([process.execPath, resolve("dist/cli.js"), "install", "--browser", "chromium", "--user-data-dir", userDataDir, "--local-archive", resolve("artifacts/runtime.zip")], { env, stdout: "pipe", stderr: "pipe" });
  if (install.exitCode) throw new Error(install.stderr.toString());
  const extension = join(home, "test-extension"); cpSync(join(data, "extension"), extension, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extension, "manifest.json"), "utf8"));
  // Only the disposable fixture copy pre-grants localhost; shipping keeps UI consent.
  manifest.host_permissions = ["http://127.0.0.1/*"]; writeFileSync(join(extension, "manifest.json"), JSON.stringify(manifest));
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("<!doctype html><title>Bridge fixture</title><h1>Native WebMCP test</h1>", { headers: { "Content-Type": "text/html" } }) });
  let browser: BrowserContext | undefined, ui: Page | undefined; const client = new Client({ name: "browser-test", version: "1" });
  const token = JSON.parse(readFileSync(join(data, "auth.json"), "utf8")).token;
  try {
    browser = await chromium.launchPersistentContext(userDataDir, { channel: "chromium", headless: true, env, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-blink-features=WebMCP"] });
    const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent("serviceworker");
    console.log("Browser worker:", worker.url());
    browser.on("weberror", error => console.error("BROWSER ERROR:", error.error().message));
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${fixture.port}`);
    const native = await page.evaluate(() => typeof (document as any).modelContext?.getTools === "function");
    console.log("Native WebMCP available:", native);
    // Release CI must exercise the actual browser API, never pass on a skipped native call.
    expect(native).toBe(true);
    await page.evaluate(async () => { await (document as any).modelContext.registerTool({ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, execute: async ({ text }: any) => text }); });
    ui = await browser.newPage(); await ui.setViewportSize({ width: 390, height: 650 });
    await ui.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
    await ui.getByText("Native host connected", { exact: true }).waitFor({ timeout: 15000 });
    await ui.getByLabel("Automatically install verified updates").uncheck();
    expect(await ui.getByLabel("Allow agent to focus tabs").isChecked()).toBe(false);
    await ui.getByLabel("Allow agent to focus tabs").check();
    await ui.reload(); await ui.getByLabel("Allow agent to focus tabs").waitFor(); expect(await ui.getByLabel("Allow agent to focus tabs").isChecked()).toBe(true);
    await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8777/mcp"), { requestInit: { headers: { Authorization: "Bearer " + token } } }));
    const fixed = await client.listTools(); expect(fixed.tools).toHaveLength(5);
    const before: any = await client.callTool({ name: "webmcp_contexts", arguments: {} }); expect(before.structuredContent.contexts).toHaveLength(0);
    await ui.getByLabel("Enable by default for this site", { exact: true }).check();
    await Bun.sleep(300);
    expect(await ui.getByLabel("Share Bridge fixture", { exact: true }).isChecked()).toBe(true);
    await ui.reload(); await ui.getByLabel("Enable by default for this site").waitFor();
    expect(await ui.getByLabel("Enable by default for this site").isChecked()).toBe(true);
    const result: any = await client.callTool({ name: "webmcp_search", arguments: {} }); const ref = result.structuredContent.tools[0].toolRef;
    const description: any = await client.callTool({ name: "webmcp_describe", arguments: { toolRefs: [ref] } });
    expect(description.structuredContent.tools[0].inputSchema.type).toBe("object");
    const request = client.callTool({ name: "webmcp_call", arguments: { toolRef: ref, arguments: { text: "native-ok" } } });
    await ui.getByRole("button", { name: "Allow once", exact: true }).click({ timeout: 10000 });
    const response: any = await request; expect(response.structuredContent.value).toBe("native-ok");
    const denied = client.callTool({ name: "webmcp_call", arguments: { toolRef: ref, arguments: { text: "must-not-run" } } });
    await ui.getByRole("button", { name: "Deny", exact: true }).click({ timeout: 10000 });
    expect((await denied).isError).toBe(true);
    await ui.screenshot({ path: "artifacts/popup.png" });
    await ui.getByLabel("Share Bridge fixture", { exact: true }).uncheck(); await Bun.sleep(300);
    const disabled: any = await client.callTool({ name: "webmcp_contexts", arguments: {} }); expect(disabled.structuredContent.contexts).toHaveLength(0);
    await ui.getByRole("button", { name: "Use site default", exact: true }).click(); await Bun.sleep(300);
    const again: any = await client.callTool({ name: "webmcp_search", arguments: {} }); const fresh = again.structuredContent.tools[0].toolRef;
    expect(fresh).not.toBe(ref);
    await page.reload(); await Bun.sleep(400);
    expect((await client.callTool({ name: "webmcp_call", arguments: { toolRef: fresh, arguments: { text: "stale" } } })).isError).toBe(true);
    expect((await client.listTools()).tools).toEqual(fixed.tools);
    console.log("NATIVE_WEBMCP_E2E_PASSED: discovery, describe, approved execution, denial, persistent defaults, overrides, stale refs, invariant tools");
  } catch (error) {
    if (ui) { console.error("POPUP DIAGNOSTICS:", await ui.locator("body").innerText().catch(() => "unavailable")); await ui.screenshot({ path: "artifacts/popup-failure.png" }).catch(() => {}); }
    console.error("BROKER LOG:", existsSync(join(data, "broker.log")) ? readFileSync(join(data, "broker.log"), "utf8").slice(-6000) : "No broker was launched");
    console.error("INSTALLATION:", install.stdout.toString());
    throw error;
  } finally { await client.close().catch(() => {}); await browser?.close(); await fetch("http://127.0.0.1:8777/admin/stop", { method: "POST", headers: { Authorization: "Bearer " + token } }).catch(() => {}); fixture.stop(); await Bun.sleep(700); rmSync(home, { recursive: true, force: true }); }
}, 60000);
