# Harness configuration recipes

Read the main [skill](../SKILL.md) first for browser-first startup and operator
instructions. This reference configures a **local stdio subprocess**, not a
remote HTTP MCP endpoint.

## Contents

- [Shared rules](#shared-rules)
- [pi](#pi)
- [OpenCode](#opencode)
- [Claude Code](#claude-code)
- [Codex CLI](#codex-cli)
- [Cursor](#cursor)
- [VS Code with GitHub Copilot](#vs-code-with-github-copilot)
- [Gemini CLI](#gemini-cli)
- [Claude Desktop](#claude-desktop)
- [Windows and GUI launchers](#windows-and-gui-launchers)
- [Compatibility](#compatibility)

## Shared rules

Every example uses port `38471`, package version `0.1.1` and origin
`https://app.example.com`. Replace the origin with the actual
`location.origin`; do not use an API hostname or a URL containing a path.
Use a different port for each concurrently running harness. One pcmbew process
accepts one browser connection at a time.

The package is public on npmjs.org. No GitHub token, `.npmrc` scope override or
package login is required for these examples. Prewarm it once from the same
environment as the harness:

```bash
bun x --bun @themakers/pcmbew@0.1.1 --help
```

Use **one** applicable recipe. Merge the entry into existing settings; never
replace a complete user config with a sample. Start the site's
`pcmbew(38471)` retry loop before starting/restarting the MCP server.

These clients do not share a config schema:

| Harness | Configuration / adapter | Top-level shape |
| --- | --- | --- |
| pi | Explicit extension below | Extension API; no assumed universal MCP JSON file |
| OpenCode | Project `opencode.json` | `mcp`, then `type: "local"` and command array |
| Claude Code | Project `.mcp.json` or `claude mcp add` | `mcpServers` |
| Codex CLI | User `~/.codex/config.toml` | `[mcp_servers.pcmbew]` |
| Cursor | Project `.cursor/mcp.json` | `mcpServers` |
| VS Code Copilot | Workspace `.vscode/mcp.json` | `servers`, then `type: "stdio"` |
| Gemini CLI | User `~/.gemini/settings.json` | `mcpServers` |
| Claude Desktop | Desktop app config | `mcpServers` |

For config files, `command` is an executable path, not a whole shell string.
Do not assume the harness invokes a shell. Prefer an absolute Bun path for GUI
clients when PATH lookup is unreliable.

## pi

Do not create a `.mcp.json` and assume pi loads it. A skill alone cannot
register executable pi tools.

This repository includes an **opt-in reference extension** at
[`examples/pi/index.ts`](../examples/pi/index.ts). It uses pi's extension API
and the official MCP SDK, starts pcmbew lazily, and exposes one pi tool named
`pcmbew` with `list`, `call` and `disconnect` actions. It does not inject every
website tool into pi's native tool catalogue; the model must list schemas first
and then call by exact name.

Install the reference extension dependencies:

```bash
cd /absolute/path/to/pcmbew/examples/pi
bun install
```

First activate `pcmbew(38471)` in the website Console. Then launch pi with the
extension and correct origin (POSIX example):

```bash
PCMBEW_ORIGIN=https://app.example.com PCMBEW_PORT=38471 pi -e ./index.ts
```

The command assumes the installed pi supports `-e`; check `pi --help`.
`PCMBEW_BUN` may contain an absolute Bun executable path when `bun` is not in
pi's PATH.

Tell pi to list website tools first:

```json
{"action":"list"}
```

After inspecting the returned schemas, a safe read might be:

```json
{"action":"call","tool":"pcmbew_status","arguments":{}}
```

Use that only when the site actually listed `pcmbew_status` with the expected
schema. Disconnect through the extension with:

```json
{"action":"disconnect"}
```

`list`/`call` use a 120,000 ms initialization timeout; individual requests use
60,000 ms. Requests are not automatically replayed after an error. After an
uncertain mutation, inspect application state before making another call.

These JSON objects are **tool arguments**, not settings files or terminal
commands. Read the extension before loading it: extensions execute with the
agent's local permissions.

## OpenCode

Merge into project `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "pcmbew": {
      "type": "local",
      "command": ["bun", "x", "--bun", "@themakers/pcmbew@0.1.1", "--port", "38471", "--origin", "https://app.example.com"],
      "enabled": true,
      "timeout": 120000
    }
  }
}
```

The timeout is in milliseconds in this recipe. Check the installed CLI, then
inspect the connection:

```bash
opencode --version
opencode mcp list
```

Start/restart OpenCode after the browser retry loop is active. An enabled entry
is not proof that MCP initialization or tool discovery succeeded.

Source: [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers/).

## Claude Code

Choose a project config or CLI registration; do not create duplicate entries at
multiple scopes.

Project `.mcp.json`:

```json
{
  "mcpServers": {
    "pcmbew": {
      "command": "bun",
      "args": ["x", "--bun", "@themakers/pcmbew@0.1.1", "--port", "38471", "--origin", "https://app.example.com"]
    }
  }
}
```

Or register at user scope:

```bash
claude mcp add --transport stdio --scope user pcmbew -- bun x --bun @themakers/pcmbew@0.1.1 --port 38471 --origin https://app.example.com
```

When the installed Claude Code supports `MCP_TIMEOUT`, allow enough time for
initialization:

```bash
MCP_TIMEOUT=120000 claude
```

This variable is measured in milliseconds and belongs to the harness process.
Do not invent a `.mcp.json` timeout key. Use `/mcp` inside Claude Code to inspect
or reconnect the server and `claude mcp list` to inspect registration. Keep
normal permission prompts enabled.

Source: [Claude Code MCP](https://code.claude.com/docs/en/mcp).

## Codex CLI

Merge into `~/.codex/config.toml`, or the corresponding file under the
installation's configured `CODEX_HOME`. Update an existing table rather than
appending a duplicate.

```toml
[mcp_servers.pcmbew]
command = "bun"
args = ["x", "--bun", "@themakers/pcmbew@0.1.1", "--port", "38471", "--origin", "https://app.example.com"]
startup_timeout_sec = 120
tool_timeout_sec = 60
```

These timeout fields use seconds. Inspect the installed configuration:

```bash
codex --version
codex mcp list
codex mcp get pcmbew
```

Start a new Codex session after activating the browser loop. Managed policy may
control whether a server may run; do not bypass it or relax the sandbox just to
hide an unexplained setup error.

Source: [Codex MCP configuration](https://developers.openai.com/codex/mcp/).

## Cursor

Merge into project `.cursor/mcp.json`, or use the supported user-level MCP
settings when the connection should not be project-specific:

```json
{
  "mcpServers": {
    "pcmbew": {
      "command": "bun",
      "args": ["x", "--bun", "@themakers/pcmbew@0.1.1", "--port", "38471", "--origin", "https://app.example.com"]
    }
  }
}
```

In Cursor's MCP/tools settings, enable or restart this server after the browser
is active. Inspect its logs/tool list and then make a harmless read. Menu labels
vary between versions; prefer the installed application's MCP controls over an
assumed label. Use an absolute Bun path for desktop launches when needed.

Source: [Cursor MCP](https://docs.cursor.com/context/model-context-protocol).

## VS Code with GitHub Copilot

Merge into workspace `.vscode/mcp.json`. Notice `servers`, not `mcpServers`, and
`type: "stdio"`:

```json
{
  "servers": {
    "pcmbew": {
      "type": "stdio",
      "command": "bun",
      "args": ["x", "--bun", "@themakers/pcmbew@0.1.1", "--port", "38471", "--origin", "https://app.example.com"]
    }
  }
}
```

Activate the page, then use the Command Palette's MCP management commands to
start pcmbew. Review workspace/server trust prompts. In Copilot Chat's agent or
tool mode, inspect/select the server tools and try a harmless read.

With SSH, WSL or container workspaces, confirm where the server process really
runs. The operator's browser must be able to reach that process's
`127.0.0.1:38471`; remote loopback is not automatically the local browser host.

Source: [VS Code MCP servers](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).

## Gemini CLI

Merge into the applicable Gemini settings file, commonly
`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "pcmbew": {
      "command": "bun",
      "args": ["x", "--bun", "@themakers/pcmbew@0.1.1", "--port", "38471", "--origin", "https://app.example.com"],
      "timeout": 120000,
      "trust": false
    }
  }
}
```

Here `timeout` is in milliseconds. Keep `trust: false` so the example does not
opt out of normal confirmation. Activate the browser before starting Gemini.
Use the installed CLI's MCP inspection commands (for versions providing them,
`gemini mcp list` and `/mcp`) before making a harmless read.

Source: [Gemini CLI MCP server configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

## Claude Desktop

Claude Desktop and Claude Code are different clients. Open the Desktop app's
developer settings and MCP configuration file. Common locations are:

```text
macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
Windows: %APPDATA%\Claude\claude_desktop_config.json
```

Merge this entry, replacing `bun` with its absolute path when needed:

```json
{
  "mcpServers": {
    "pcmbew": {
      "command": "bun",
      "args": ["x", "--bun", "@themakers/pcmbew@0.1.1", "--port", "38471", "--origin", "https://app.example.com"]
    }
  }
}
```

Quit the app fully, activate the site's retry loop, then reopen it. Check the
local server status/logs and whether tools appear in the chat's tool controls.
Do not add Claude Code's `MCP_TIMEOUT` and assume it controls Desktop.

Source: [Connecting local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

## Windows and GUI launchers

Use the native Bun executable path when available. JSON requires escaped
backslashes, for example `C:\\Users\\Alice\\.bun\\bin\\bun.exe`.

For harnesses using `command`/`args`, a Windows client that cannot spawn
`npx.cmd` directly can use this subprocess descriptor:

```json
{
  "command": "cmd",
  "args": ["/d", "/s", "/c", "npx", "--yes", "@themakers/pcmbew@0.1.1", "--port", "38471", "--origin", "https://app.example.com"]
}
```

Insert the descriptor at the correct location for the chosen harness; it is not
a complete config file. OpenCode uses its command-array shape instead. Prefer
the native Bun recipe when possible.

## Compatibility

The upstream links above are references for current configuration concepts, not
a claim that every release was exercised during documentation creation. Record
`--version` and confirm flags, configuration scope and timeout semantics in the
installed harness. A schema check cannot prove a real browser-to-harness
connection.

When a client differs from these recipes, adapt to its documented **local
stdio** MCP interface, preserve normal approvals, and prove the connection with
tool discovery followed by a safe read.
