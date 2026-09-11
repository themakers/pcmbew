# Harness setup

Use the main [skill](../SKILL.md) first. The agent runs installation/configuration
inside the local harness; the operator only handles Chrome extension UI consent.

## Contents

- [Use the generated descriptor](#use-the-generated-descriptor)
- [Claude Code, Cursor, Gemini and Desktop](#claude-code-cursor-gemini-and-desktop)
- [Codex CLI](#codex-cli)
- [OpenCode](#opencode)
- [VS Code Copilot](#vs-code-copilot)
- [pi](#pi)
- [Direct HTTP](#direct-http)

## Use the generated descriptor

Run `webmcp-bridge-ext config` after installation. Its output has this shape:

```json
{
  "mcpServers": {
    "webmcp-bridge-ext": {
      "command": "/absolute/path/to/node-or-bun",
      "args": ["/absolute/user/home/.webmcp-bridge-ext/runner.cjs", "stdio"],
      "env": { "WEBMCP_HOME": "/absolute/user/home/.webmcp-bridge-ext" }
    }
  }
}
```

Use the **actual** generated paths, not these placeholders. The stable runner
follows the installed runtime version after an update. The stdio adapter is
an authenticated client of `http://127.0.0.1:8777/mcp`, not a second browser
server. Its five tool definitions never change with browser activity.

Inspect the existing configuration first, back it up, and merge the entry.
Retain ordinary approvals and sandbox/managed-policy constraints. Runtime paths
are executables, not shell command strings; no `~` expansion is assumed.
Windows JSON paths need escaped backslashes. An absolute runtime path avoids
GUI PATH problems. No package token or local bearer token belongs in this
adapter configuration.

Recipes describe documented configuration shapes, not an assertion that every
installed harness version was end-to-end tested. Verify the installed version's
schema/CLI before editing it. Tool invocation timeouts should allow roughly
150 seconds for optional popup approval plus execution.

## Claude Code, Cursor, Gemini and Desktop

All four use `mcpServers` with `command`, `args`, and optional `env` for local
stdio servers. Merge the generated entry into the correct file:

| Client | Common location | Verification |
|---|---|---|
| Claude Code | Project `.mcp.json`; use CLI registration for user scope | `claude mcp list`; `/mcp` in session |
| Cursor | Project `.cursor/mcp.json`, or user MCP settings | MCP/tool status in settings and Agent mode |
| Gemini CLI | `~/.gemini/settings.json` | `gemini mcp list` / `/mcp` where available |
| Claude Desktop, macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` | Fully restart app, inspect local MCP status |
| Claude Desktop, Windows | `%APPDATA%\Claude\claude_desktop_config.json` | Fully restart app, inspect local MCP status |

Claude Code CLI registration, substituting actual paths:

```bash
claude mcp add --transport stdio --scope user webmcp-bridge-ext -- /absolute/runtime /absolute/home/.webmcp-bridge-ext/runner.cjs stdio
```

Use the generated `env` too when the installation root was overridden. Choose
either CLI registration or project file, not duplicates. Do not assume Claude
Code environment timeout knobs also work in Desktop. In Gemini, retain
`trust: false` unless the operator explicitly chooses otherwise.

Sources: [Claude Code](https://code.claude.com/docs/en/mcp),
[Cursor](https://docs.cursor.com/context/model-context-protocol),
[Gemini](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md),
[Desktop](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

## Codex CLI

Merge into `~/.codex/config.toml` or the file under the configured `CODEX_HOME`.
Do not append a second definition of an existing TOML table:

```toml
[mcp_servers.webmcp-bridge-ext]
command = "/absolute/path/to/node-or-bun"
args = ["/absolute/user/home/.webmcp-bridge-ext/runner.cjs", "stdio"]
startup_timeout_sec = 30
tool_timeout_sec = 150

[mcp_servers.webmcp-bridge-ext.env]
WEBMCP_HOME = "/absolute/user/home/.webmcp-bridge-ext"
```

Check `codex mcp list` and `codex mcp get webmcp-bridge-ext`. Restart the session
if necessary. This adapter's startup does not wait for a website to connect.
Source: [Codex MCP](https://developers.openai.com/codex/mcp/).

## OpenCode

Convert the descriptor to OpenCode's `mcp` / `type: local` / command-array shape
in project `opencode.json` or the applicable user config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "webmcp-bridge-ext": {
      "type": "local",
      "command": ["/absolute/runtime", "/absolute/home/.webmcp-bridge-ext/runner.cjs", "stdio"],
      "environment": { "WEBMCP_HOME": "/absolute/home/.webmcp-bridge-ext" },
      "enabled": true,
      "timeout": 150000
    }
  }
}
```

`environment`, not `env`; this recipe uses milliseconds. Inspect with
`opencode mcp list`, then use `webmcp_contexts` in the session.
Source: [OpenCode MCP](https://opencode.ai/docs/mcp-servers/).

## VS Code Copilot

Workspace `.vscode/mcp.json` uses `servers` rather than `mcpServers`:

```json
{
  "servers": {
    "webmcp-bridge-ext": {
      "type": "stdio",
      "command": "/absolute/runtime",
      "args": ["/absolute/home/.webmcp-bridge-ext/runner.cjs", "stdio"],
      "env": { "WEBMCP_HOME": "/absolute/home/.webmcp-bridge-ext" }
    }
  }
}
```

Use the installed version's MCP server management commands, accept the expected
workspace/server trust prompt, and select the five tools in Copilot's agent
mode. In SSH/WSL/container workspaces, ensure the subprocess really runs on the
browser host. Remote workspace loopback is not the user's local Chrome.
Source: [VS Code MCP](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).

## pi

Do not invent a universal `.mcp.json` for pi. The runtime release contains an
optional `dist/pi.js` extension registering the **same five stable tools** using
pi's extension API and the MCP SDK. Its runtime dependencies are bundled in the
versioned installation; no user code editing or extra npm login is required.

For one session, the agent can launch the installed pi with the explicit
extension path (substitute the version reported by `doctor`):

```bash
pi -e /absolute/home/.webmcp-bridge-ext/versions/1.0.0/dist/pi.js
```

For persistence, use the installed pi's extension settings/directory mechanism.
Point it to this file or create a reviewed local loader which resolves
`~/.webmcp-bridge-ext/current.json` and imports that version's `dist/pi.js`.
A custom installation root must reach pi as `WEBMCP_HOME`. Do not load multiple
copies of the extension. Restart/reload pi after changing extension settings.

Skill installation and executable extension installation are separate. A pi
MCP extension already installed may also consume the generated stdio descriptor;
follow **that extension's** actual schema instead of loading two adapters.
Source: [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

## Direct HTTP

Clients with native Streamable HTTP support can use
`http://127.0.0.1:8777/mcp` and `Authorization: Bearer <local-token>`.
The token is generated in `~/.webmcp-bridge-ext/auth.json` with restricted local
permissions. It is not a GitHub/npm token or a website credential.

Have the agent configure it locally without echoing it into the conversation,
using the client's supported secret/environment mechanism. Prefer the bundled
stdio adapter when its mechanism is unclear. Do not put the token in a URL,
commit it or send it to an external host. Browser-Origin HTTP requests are
rejected; the extension uses Native Messaging, not this HTTP endpoint.
