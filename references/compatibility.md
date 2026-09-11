# Native API and installation compatibility

Read this when the native host is not found or a Chrome version exposes a different WebMCP descriptor shape.

## Non-default Chrome user data directories

On macOS/Linux Chrome searches for native host manifests inside its user-data directory. For a browser started with a non-default `--user-data-dir`, the agent must pass that directory to installation:

```bash
bun x --bun @themakers/webmcp-bridge-ext@1.0.0 install --user-data-dir /absolute/chrome-user-data
```

Use the browser **user-data root**, not its `Default` or `Profile 1` child directory. `--browser chromium` selects Chromium's default path when no override is supplied. The installer records an explicit path and preserves it across updates. Windows uses per-user HKCU native-host registration instead. The agent inspects the local browser launch configuration; the operator does not need to edit registry entries or manifests.

## Native WebMCP API revisions

Chrome for Testing 153.0.8010.12 returns `RegisteredTool.inputSchema` as a JSON string and accepts JSON-string execution arguments. The newer Chromium implementation returns an object schema and accepts an object argument. The adapter normalizes the catalogue schema but preserves the actual native tool object and selects the matching argument representation **before the single invocation**. It never retries a tool to discover which convention works.

Sources: [tested Chrome revision](https://github.com/chromium/chromium/blob/153.0.8010.12/third_party/blink/renderer/core/script_tools/model_context.idl), [newer Chromium interface](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/script_tools/model_context.idl).

Both APIs are native `document.modelContext`; neither is a testing polyfill. A native result string is preserved without guessing whether it contains JSON. Unsupported browser APIs produce diagnostics, not automatic injection of a substitute registry.

## Runtime reconnection

After an updater restart, an HTTP MCP session may expire. The stdio/pi adapters discard a failed session and reconnect for the next invocation. They do not replay the failed invocation. Rediscover page/tool references after restart and inspect application state before repeating a mutation whose outcome is unknown.
