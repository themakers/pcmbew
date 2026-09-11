# Native API and installation compatibility

Read this for first-release availability, supported runtimes, native-host discovery or WebMCP API differences.

## Release availability and runtime

Use **Bun 1.4.2 or newer**, or **Node 22 or newer**. Release signing and installation were verified with Bun 1.4.2 and Node 22. Bun 1.3.0 has an incompatible default-digest behavior in the EC crypto operation used by Sigstore and must not be used for this installer.

**Release status, 2026-09-11:** the complete signed GitHub release `v1.0.0` is public. Installation fetched and verified that public release successfully under both Node and Bun. npm publication was attempted and returned `ENEEDAUTH`; the CI publisher does not yet have npm authorization. Do not ask an operator for an npm or GitHub token. Until the npm package is published, the agent should use the public release archive directly:

```bash
npx --yes https://github.com/themakers/webmcp-bridge-ext/releases/download/v1.0.0/themakers-webmcp-bridge-ext-1.0.0.tgz install
```

After installation, use the installed stable runner for subsequent commands instead of repeatedly resolving an unpublished npm package:

```bash
node /absolute/installation-root/runner.cjs config
node /absolute/installation-root/runner.cjs doctor
```

Substitute the actual installation root (the parent of the returned `extensionDirectory`); use the installed Bun executable instead of `node` on a Bun-only workstation. The agent runs these commands, not the operator.

For maintainers only: authorize npm publication using the repository secret `NPM_TOKEN` or a configured npm trusted publisher for `themakers/webmcp-bridge-ext`, workflow `release.yml`. Then run **Release** on `master` with `npm_only=true`, `tag=v1.0.0`. This publishes the existing checked archive without rebuilding it, changing the published tag or replacing signed GitHub assets. Publisher credentials are not installation requirements.

Evidence: [published release](https://github.com/themakers/webmcp-bridge-ext/releases/tag/v1.0.0), [release and public-install verification](https://github.com/themakers/webmcp-bridge-ext/actions/runs/34652700164), [npm authentication result](https://github.com/themakers/webmcp-bridge-ext/actions/runs/34653014639).

## Non-default Chrome user data directories

On macOS/Linux Chrome searches for native host manifests inside its user-data directory. For a browser started with a non-default `--user-data-dir`, the agent must pass that directory to installation. Append this option to the selected installer command:

```text
--user-data-dir /absolute/chrome-user-data
```

Use the browser **user-data root**, not its `Default` or `Profile 1` child directory. `--browser chromium` selects Chromium's default path when no override is supplied. The installer records an explicit path and preserves it across updates. Windows uses per-user HKCU native-host registration instead. The agent inspects the local browser launch configuration; the operator does not need to edit registry entries or manifests.

## Native WebMCP API revisions

Chrome for Testing 153.0.8010.12 returns `RegisteredTool.inputSchema` as a JSON string and accepts JSON-string execution arguments. The newer Chromium implementation returns an object schema and accepts an object argument. The adapter normalizes the catalogue schema but preserves the actual native tool object and selects the matching argument representation **before the single invocation**. It never retries a tool to discover which convention works.

Sources: [tested Chrome revision](https://github.com/chromium/chromium/blob/153.0.8010.12/third_party/blink/renderer/core/script_tools/model_context.idl), [newer Chromium interface](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/script_tools/model_context.idl).

Both APIs are native `document.modelContext`; neither is a testing polyfill. A native result string is preserved without guessing whether it contains JSON. Unsupported browser APIs produce diagnostics, not automatic injection of a substitute registry.

The release's browser test runs Chrome for Testing 153.0.8010.12 on Linux with `--enable-blink-features=WebMCP` and a disposable extension copy authorized only for the local fixture. Native tool execution is required for that test to pass. The test proves the real Native Messaging and WebMCP call path, popup approval/denial, persistent defaults, overrides and stale references. It does not assert that WebMCP is enabled by default in every Chrome channel. Windows/macOS browser integration, every harness runtime, and a complete cross-version automatic-update cycle have not been end-to-end tested.

## Runtime reconnection

After an updater restart, an HTTP MCP session may expire. The stdio/pi adapters discard a failed session and reconnect for the next invocation. They do not replay the failed invocation. Rediscover page/tool references after restart and inspect application state before repeating a mutation whose outcome is unknown.
