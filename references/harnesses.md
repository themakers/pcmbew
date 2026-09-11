# Harness configuration recipes

Read the main [skill](../SKILL.md) first for registry authentication, the
browser-first startup order and the operator instructions. This reference
configures a **local stdio subprocess**, not a remote HTTP MCP endpoint.

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
- [Compatibility and sources](#compatibility-and-sources)

## Shared rules

Every example uses port `38471`, package version `0.1.0` and origin
`https://app.example.com`. Replace the origin everywhere with the actual
`location.origin`; do not replace it with an API hostname or a URL containing
a path. Use a different port for each concurrently running harness. A proxy
accepts only one browser connection at a time.

Use **one** applicable recipe. Merge the server entry into existing settings;
never replace a complete user config with a sample. Keep secrets out of the
JSON/TOML examples. Complete registry setup and `--help` prewarming first.
Start the site's `pcmbew(38471)` retry loop before starting the MCP server.

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
| Claude Desktop | Desktop app's config file | `mcpServers` |

For config files, `command` is an executable path, not a whole shell string.
Do not embed `~`, shell variable assignments or quoted command lines and
assume the harness runs a shell. Prefer an absolute executable path for GUI
clients. The environment needed for GitHub Packages must reach the **child**
process, not merely the parent application.

## pi

Do not create a `.mcp.json` and assume pi loads it. An installed pi MCP
extension may have its own configuration schema; follow that extension's
actual documentation. A skill alone cannot register executable pi tools.

For a concrete, self-contained alternative, this repository includes an
**opt-in reference extension** at [`examples/pi/index.ts`](../examples/pi/index.ts).
It uses pi's extension API and the official MCP SDK, starts pcmbew lazily,
and exposes **one pi tool named `pcmbew`** with `list`, `call` and `disconnect`
actions. It does not pretend to inject each website tool into pi's native
tool catalogue. The model must list, inspect the schemas, then call by name.
The core pcmbew package does not depend on pi.

Install the reference extension's dependencies with Bun:

```bash
cd /absolute/path/to/pcmbew/examples/pi
bun install
```

First activate `pcmbew(38471)` in the website Console. Then launch pi with the
extension and the correct origin (POSIX shell example):

```bash
PCMBEW_ORIGIN=https://app.example.com PCMBEW_PORT=38471 pi -e ./index.ts
```

The command assumes the installed pi supports `-e` for loading an extension;
check `pi --help`. `PCMBEW_BUN` can hold an absolute Bun executable path when
`bun` is not in pi's PATH. The extension forwards `NODE_AUTH_TOKEN` and
`NPM_CONFIG_USERCONFIG` when present, plus the MCP SDK's default environment;
it does not copy every environment variable indiscriminately.

Tell pi to **list website tools first**. Its call to the extension is:

```json
{"action":"list"}
```

After inspecting the returned schemas, a safe read might look like this,
**only if the site actually listed `pcmbew_status` with that schema**:

```json
{"action":"call","tool":"pcmbew_status","arguments":{}}
```

Disconnect and discard the bridge's queue through the extension:

```json
{"action":"disconnect"}
```

`list`/`call` establish a connection with a 120,000 ms initialization timeout;
individual requests use a 60,000 ms timeout. An unavailable page must be
activated by the operator, not worked around by exporting cookies. Requests
are not automatically replayed after an error. After an uncertain mutation,
check the application's state before making another `call`.

These JSON objects are **tool arguments**, not settings files or terminal
commands. Install the skill separately to teach pi the workflow. Read the
extension before loading it: extensions execute code with the agent's local
permissions. Its MCP result is returned as text JSON with original content,
structured result and error fields preserved inside that JSON.

## OpenCode

Merge into the project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "pcmbew": {
      "type": "local",
      "command": ["bun", "x", "--bun", "@themakers/pcmbew@0.1.0", "--port", "38471", "--origin", "https://app.example.com"],
      "enabled": true,
      "timeout": 120000
    }
  }
}
```

Use OpenCode's documented user config location for a user-wide installation
rather than writing project settings into every checkout. The MCP `timeout`
value is in **milliseconds** in this recipe. `environment`, not `env`, is the
OpenCode-specific name when an explicit child environment is needed; use its
supported secret/environment substitution rather than a committed token.

Check installed command syntax, then inspect the connection:

```bash
opencode --version
opencode mcp list
```

Start/restart OpenCode after the browser retry loop is active. Inspect the
available tools in the session and make a safe read. A enabled server entry
is not evidence that initialization or tool discovery succeeded.

Source: [OpenCode MCP servers](https://opencode.ai/docs/mcp-servers/).

## Claude Code

Choose either a project config or the CLI registration path; do not create
duplicate entries at several scopes.

Project `.mcp.json`:

```json
{
  "mcpServers": {
    "pcmbew": {
      "command": "bun",
      "args": ["x", "--bun", "@themakers/pcmbew@0.1.0", "--port", "38471", "--origin", "https://app.example.com"]
    }
  }
}
```

Alternatively, register it at user scope from the terminal:

```bash
claude mcp add --transport stdio --scope user pcmbew -- bun x --bun @themakers/pcmbew@0.1.0 --port 38471 --origin https://app.example.com
```

When the installed Claude Code supports `MCP_TIMEOUT`, allow time for
initialization before launching it (POSIX shell):

```bash
MCP_TIMEOUT=120000 claude
```

This variable is measured in milliseconds. It belongs to the harness
process; putting it only in the server child's environment will not change
the parent's startup deadline. Do not substitute an undocumented `timeout`
field in `.mcp.json`. Browser-first startup is useful even with a longer limit.

Use `/mcp` inside Claude Code to inspect/reconnect the server and approve a
project-scoped config when prompted. Use `claude mcp list` for registration
inspection. Then enumerate actual site tools and choose a harmless read.
Do not use `--dangerously-skip-permissions` for setup.

Source: [Claude Code MCP](https://code.claude.com/docs/en/mcp).

## Codex CLI

Merge into `~/.codex/config.toml`, or the corresponding file under the
installation's configured `CODEX_HOME`. A TOML table may only be defined once:
update an existing `mcp_servers.pcmbew` table rather than appending a duplicate.

```toml
[mcp_servers.pcmbew]
command = "bun"
args = ["x", "--bun", "@themakers/pcmbew@0.1.0", "--port", "38471", "--origin", "https://app.example.com"]
startup_timeout_sec = 120
tool_timeout_sec = 60
env_vars = ["NODE_AUTH_TOKEN", "NPM_CONFIG_USERCONFIG"]
```

The timeout fields here use **seconds**, unlike OpenCode's recipe. The
`env_vars` allowlist forwards named variables when they are present in the
parent environment; it does not store a token. Remove entries not used by
your authentication setup rather than setting them to an empty token.

Inspect the installed configuration:

```bash
codex --version
codex mcp list
codex mcp get pcmbew
```

Start a new Codex session after activating the browser loop. Use the session's
MCP/tool status, then a harmless site read. A trusted project/managed policy
may control whether a server may run; do not bypass that policy. Do not turn
a sandbox into unrestricted execution merely to hide an unexplained error.

Source: [Codex MCP configuration](https://developers.openai.com/codex/mcp/).

## Cursor

Merge into project `.cursor/mcp.json`, or use the supported user-level MCP
settings when the connection should not be tied to one project:

```json
{
  "mcpServers": {
    "pcmbew": {
      "command": "bun",
      "args": ["x", "--bun", "@themakers/pcmbew@0.1.0", "--port", "38471", "--origin", "https://app.example.com"]
    }
  }
}
```

In Cursor's MCP/tools settings, enable or restart this server after the
browser is active. Inspect its logs and tool list, then use Agent mode with
the server's tools enabled. Setting labels vary between versions; prefer the
installed application's MCP controls over an assumed menu name.

Use an absolute Bun executable path and user-level registry authentication
when Cursor is launched from a desktop icon. This recipe intentionally does
not invent a portable startup-timeout field for Cursor. Prewarm the package,
activate the page first and use the installed client's supported controls.

Source: [Cursor MCP](https://docs.cursor.com/context/model-context-protocol).

## VS Code with GitHub Copilot

Merge into workspace `.vscode/mcp.json`. Notice **`servers`**, not
`mcpServers`, and **`type: "stdio"`**:

```json
{
  "servers": {
    "pcmbew": {
      "type": "stdio",
      "command": "bun",
      "args": ["x", "--bun", "@themakers/pcmbew@0.1.0", "--port", "38471", "--origin", "https://app.example.com"]
    }
  }
}
```

Activate the page, then use the Command Palette's MCP server management
(`MCP: List Servers` in versions offering that command) to start pcmbew.
Review the workspace/server trust prompt. In Copilot Chat's agent/tool mode,
select the server's tools, inspect the list and try a harmless read.

VS Code running locally can still spawn extensions/tools remotely in an
SSH, WSL or container workspace. Confirm where **this server process** runs.
The operator's ordinary browser must be able to reach its `127.0.0.1:38471`;
a remote environment's loopback is not automatically the same host.

Source: [VS Code MCP servers](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).

## Gemini CLI

Merge into the applicable Gemini settings file, commonly user-level
`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "pcmbew": {
      "command": "bun",
      "args": ["x", "--bun", "@themakers/pcmbew@0.1.0", "--port", "38471", "--origin", "https://app.example.com"],
      "timeout": 120000,
      "trust": false
    }
  }
}
```

In this recipe `timeout` is in **milliseconds**. Keep `trust: false` so the
example does not opt out of normal confirmation. Activate the browser before
starting Gemini. Inspect registration with the installed CLI's MCP commands
(for versions providing them, `gemini mcp list`) and use `/mcp` in the session
to inspect tools. Check version-specific settings for environment filtering
when a package-read token is not reaching the child.

Source: [Gemini CLI MCP server configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

## Claude Desktop

Claude Desktop and Claude Code are different clients. Open the Desktop app's
developer settings and its MCP configuration file. Common locations are:

```text
macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
Windows: %APPDATA%\Claude\claude_desktop_config.json
```

Merge this entry, replacing `bun` with its absolute path when necessary:

```json
{
  "mcpServers": {
    "pcmbew": {
      "command": "bun",
      "args": ["x", "--bun", "@themakers/pcmbew@0.1.0", "--port", "38471", "--origin", "https://app.example.com"]
    }
  }
}
```

Quit the app fully, activate the site's retry loop, then reopen the app.
Check the local server status/logs and whether the tools appear in the chat's
tool controls. A shell's exported token may not be inherited by the GUI; use
authentication accessible to the launched subprocess. Do not add Claude Code's
`MCP_TIMEOUT` and assume it controls Desktop. No Desktop timeout key is
promised by this recipe.

Source: [Connecting local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

## Windows and GUI launchers

Use the native Bun executable path when available. JSON requires escaped
backslashes, for example `C:\\Users\\Alice\\.bun\\bin\\bun.exe`. Do not
copy `Alice` literally. An absolute path contains no shell expansion.

For harnesses using the `command`/`args` schema, a Windows client that cannot
spawn `npx.cmd` directly can use this subprocess descriptor:

```json
{
  "command": "cmd",
  "args": ["/d", "/s", "/c", "npx", "--yes", "@themakers/pcmbew@0.1.0", "--port", "38471", "--origin", "https://app.example.com"]
}
```

Insert the descriptor at the correct location in the selected harness schema;
it is not a complete config file. OpenCode needs its command-array shape
instead. Only pass fixed, reviewed arguments through `cmd`; do not interpolate
untrusted page text into a shell command. Prefer the native Bun recipe when
possible to avoid command-shell differences.

## Compatibility and sources

The upstream links above are references for the installed version's settings,
not a claim that every current release was exercised during documentation
creation. Record `--version` and confirm flags, configuration scope, timeout
semantics and environment handling locally. A documentation/schema check
cannot prove a real browser-to-harness connection.

For pi's extension mechanism, consult the installed pi documentation and
[pi coding-agent documentation](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).
For registry access, consult [GitHub's npm registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).
When a client differs from these recipes, adapt to its documented **local
stdio** MCP interface, preserve normal approvals, and prove the connection
with tool discovery followed by a safe read.
