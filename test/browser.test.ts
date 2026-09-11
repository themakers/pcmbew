import { test, expect } from "bun:test";
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EXTENSION_ID } from "../src/shared";
test("Chrome popup, persistent policy, native host and native WebMCP when exposed", async () => {
  const home = mkdtempSync(join(tmpdir(), "webmcp-browser-")), data = join(home, "bridge");
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), WEBMCP_HOME: data };
  const install = Bun.spawnSync([process.execPath, resolve("dist/cli.js"), "install", "--browser", "chromium", "--local-archive", resolve("artifacts/runtime.zip")], { env, stdout: "pipe", stderr: "pipe" });
  if (install.exitCode) throw new Error(install.stderr.toString());
  const extension = join(home, "test-extension"); cpSync(join(data, "extension"), extension, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extension, "manifest.json"), "utf8"));
  // Only this disposable test copy pre-grants fixture-host access. Shipping
  // artifacts keep optional permissions and require the user's UI grant.
  manifest.host_permissions = ["http://127.0.0.1/*"]; writeFileSync(join(extension, "manifest.json"), JSON.stringify(manifest));
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("<!doctype html><title>Bridge fixture</title><h1>Native WebMCP test</h1>", { headers: { "Content-Type": "text/html" } }) });
  let browser: BrowserContext | undefined, ui: Page | undefined; const client = new Client({ name: "browser-test", version: "1" });
  const token = JSON.parse(readFileSync(join(data, "auth.json"), "utf8")).token;
  try {
    browser = await chromium.launchPersistentContext(join(home, "profile"), { channel: "chromium", headless: true, env, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-blink-features=WebMCP"] });
    const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent("serviceworker");
    console.log("Browser worker:", worker.url);
    browser.on("weberror", error => console.error("BROWSER ERROR:", error.error().message));
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${fixture.port}`);
    const native = await page.evaluate(() => typeof (document as any).modelContext?.getTools === "function");
    console.log("Native WebMCP available:", native);
    if (native) await page.evaluate(async () => { await (document as any).modelContext.registerTool({ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, execute: async ({ text }: any) => text }); });
    ui = await browser.newPage(); await ui.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
    await ui.getByText("Native host connected", { exact: true }).waitFor({ timeout: 15000 });
    await ui.getByLabel("Automatically install verified updates").uncheck();
    await ui.getByLabel("Allow agent to focus tabs").check();
    await ui.reload(); await ui.getByLabel("Allow agent to focus tabs").waitFor(); expect(await ui.getByLabel("Allow agent to focus tabs").isChecked()).toBe(true);
    await ui.screenshot({ path: "artifacts/popup.png" });
    await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8777/mcp"), { requestInit: { headers: { Authorization: "Bearer " + token } } }));
    expect((await client.listTools()).tools).toHaveLength(5);
    const before: any = await client.callTool({ name: "webmcp_contexts", arguments: {} }); expect(before.structuredContent.contexts).toHaveLength(0);
    if (native) {
      await ui.getByLabel("Share Bridge fixture", { exact: true }).check({ timeout: 10000 });
      await ui.getByLabel("Confirm each website call in popup").uncheck();
      await Bun.sleep(300);
      const result: any = await client.callTool({ name: "webmcp_search", arguments: {} }); const ref = result.structuredContent.tools[0].toolRef;
      const response: any = await client.callTool({ name: "webmcp_call", arguments: { toolRef: ref, arguments: { text: "native-ok" } } }); expect(response.structuredContent.value).toBe("native-ok");
      await page.reload(); await Bun.sleep(400);
      expect((await client.callTool({ name: "webmcp_call", arguments: { toolRef: ref, arguments: { text: "stale" } } })).isError).toBe(true);
      console.log("NATIVE_WEBMCP_E2E_PASSED");
    } else console.warn("NATIVE_WEBMCP_UNAVAILABLE: popup/native-host tests passed, but this Chromium does not expose the targeted WebMCP API. No native tool-call claim is made.");
  } catch (error) {
    if (ui) { console.error("POPUP DIAGNOSTICS:", await ui.locator("body").innerText().catch(() => "unavailable")); await ui.screenshot({ path: "artifacts/popup-failure.png" }).catch(() => {}); }
    console.error("BROKER LOG:", existsSync(join(data, "broker.log")) ? readFileSync(join(data, "broker.log"), "utf8").slice(-6000) : "No broker was launched");
    console.error("INSTALLATION:", install.stdout.toString());
    throw error;
  } finally { await client.close().catch(() => {}); await browser?.close(); await fetch("http://127.0.0.1:8777/admin/stop", { method: "POST", headers: { Authorization: "Bearer " + token } }).catch(() => {}); fixture.stop(); await Bun.sleep(700); rmSync(home, { recursive: true, force: true }); }
}, 60000);
