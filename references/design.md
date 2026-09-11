# Implementation and operational contract

## Contents

- [Transport and identity](#transport-and-identity)
- [Exposure and consent](#exposure-and-consent)
- [Five stable tools](#five-stable-tools)
- [Failure semantics](#failure-semantics)
- [Installation and updates](#installation-and-updates)
- [Build and tests](#build-and-tests)

## Transport and identity

One broker owns `127.0.0.1:8777`. Each Chrome Native Messaging launch is a
connector to its local IPC socket (or Windows named pipe). The connector and
HTTP client authenticate using the same per-install random credential. A
second process cannot silently choose another TCP port. Multiple profiles get
separate channels; closing a channel invalidates its entire catalogue.

Chrome connects only to the registered native host whose allowlist contains
the fixed extension ID. Native Messaging frames are JSON preceded by a native
endianness 32-bit length. The implementation applies a 768 KiB message limit
and bounded write buffering. Business results are capped at 384 KiB.

The MCP boundary uses the pinned official TypeScript SDK's Streamable HTTP
transport and version negotiation; the code does not reimplement a speculative
newer MCP wire protocol. The optional stdio and pi adapters consume that endpoint.
Only the five constant descriptors are advertised. The server does not announce
`tools.listChanged` for page catalogue changes.

Opaque refs bind a native channel, document, frame, catalogue revision and
exposure state. Browser-provided `documentId` and frame identity come from the
extension sender, never from website JSON. Native `RegisteredTool.window`
objects stay inside the document context. Only schemas and descriptions cross
Native Messaging. Registry events rotate tool references even when a site's
new tool happens to reuse the previous name.

The content script runs in an **isolated world** and accesses the browser's
native document ModelContext. There is no arbitrary evaluation API, MAIN-world
injected control script, page postMessage command channel or DOM scraping tool.
It enumerates tools owned by that frame (`tool.window === window`) and its
origin. Same-origin frames can appear as separate contexts in discovery but
are grouped by tab/origin in the popup. A cross-origin frame needs its own
Chrome site-access permission and origin exposure decision.

Actual WebMCP availability is feature-detected. The targeted native interface
is `document.modelContext.getTools()` followed by
`executeTool(registeredTool, arguments, { signal })`; older testing APIs are
not silently treated as equivalent. A site must already register native tools.
Registration does not give an agent a general browser automation API.
Source: [Chromium ModelContext IDL](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/script_tools/model_context.idl).

## Exposure and consent

Two independent boundaries apply: Chrome grants discovery permission, then the
operator grants MCP exposure. Allowing discovery on all sites does not expose
all sites. Only effectively enabled contexts are returned through MCP.

```text
effectiveEnabled = temporaryTabOriginOverride ?? storedExactOriginDefault ?? false
```

Site defaults, focus permission, popup confirmation and update preference are
stored in `chrome.storage.local`, per profile. Temporary overrides use
`chrome.storage.session` so they survive service worker suspension, but are
removed on tab closure, cross-origin navigation or browser restart. No ephemeral
Chrome tab IDs are persisted between browser sessions. Incognito is disabled.

A changed site default does not erase manual tab overrides. The popup's
**Use site default** resets an override. Exact origin includes scheme and port;
Chrome's host permission matching can be broader, so the bridge's own exposure
check remains necessary. Site defaults authorize the account currently signed
in on that origin; universal SPA logout/account-switch detection is impossible
without site cooperation. Disable sharing before switching identities.

Generic `webmcp_call` has conservative, constant mutation annotations. It is
never marked read-only based on whichever page happens to be selected. Website
annotations are hints, not proof. Popup confirmation defaults to on for every
call; only the user can disable it. No MCP tool changes the exposure policy or
its own approval gate. Pending calls are cancelled when their context is revoked.

Manual popup focus remains available independently of the agent focus gate.
Agent focus is off by default and requires an enabled context. Foregrounding
a tab is not a trusted website click and does not manufacture user activation.

Browser metadata, input schemas and results are untrusted. Metadata loses URL
query and fragment; pathname/title may still contain private information.
Authentication/Host/Origin checks precede HTTP request parsing. Browser-Origin
HTTP calls are rejected: the extension uses Native Messaging instead. The local
broker is not intended to defend against malware already running as this OS user.

## Five stable tools

| Tool | Arguments | Result |
|---|---|---|
| `webmcp_contexts` | `{}` | Broker status and enabled context summaries |
| `webmcp_search` | optional `query`, `contextRef`, `limit`, `cursor` | Bounded compact matches and optional next cursor |
| `webmcp_describe` | `toolRefs` array, 1-16 items | Native descriptors and source context |
| `webmcp_call` | `toolRef`, `arguments` object | Original native string as `value`, plus context |
| `webmcp_focus` | `contextRef` | Focus result and context |

The broker validates both its static tool schemas and the discovered website
input schema, using AJV without fetching remote references. Unsupported schemas
fail explicitly. It allows at most eight actions globally and one per context;
excess calls are rejected, not queued. Discovery is bounded at 256 document
contexts, 128 tools per document, 256 KiB native catalogue messages, and 1 MiB
MCP result bodies.

Discovery refreshes connected contexts on demand, with a short coalescing
window. Content scripts also observe `toolchange` and refresh periodically.
Suspended/background documents may be throttled; old snapshots expire after
60 seconds rather than pretending to remain live forever. Search cursors bind
the catalogue revision and query; stale cursors require a fresh search.

## Failure semantics

Actionable errors are MCP tool results with `isError: true` and structured
`error: { code, message, outcome }`. `outcome` distinguishes rejected-before-
dispatch from an operation whose result is unknown. Transport/protocol errors
still use the official SDK's normal error handling.

A timeout or disconnect after dispatch can hide a completed backend mutation.
Cancellation is propagated best-effort to the native WebMCP AbortSignal. There
is no automatic replay, offline mutation queue, exactly-once guarantee or
bridge-generated backend idempotency key. A page can navigate during a tool;
a missing completion is not represented as successful execution.

A stable MCP catalogue only avoids browser-driven definition churn. Provider
cache eviction, message history changes, authentication, reconnects and model
configuration can still produce cache misses. Do not promise zero misses.

## Installation and updates

The one-time installer registers a per-user Chrome/Chromium native host and
creates a stable unpacked-extension folder. The user must approve **Load
unpacked** in Chrome's extension manager; there is no silent installation.
The stable public manifest key determines the ID. It is not a private signing
key and is not treated as release authenticity.

Each release contains a platform-neutral runtime ZIP including compiled JS and
production dependencies, plus an extension ZIP and npm installer archive.
A Sigstore bundle authenticates `release.json` to the exact GitHub Actions
release workflow identity for that version tag. The manifest binds SHA-256
checksums, byte lengths, version and native wire version. The updater accepts
no arbitrary artifact URLs from pages or MCP calls.

This protects against artifact tampering and unrelated signing identities.
It does **not** protect against a compromised authorized repository/release
workflow which can issue new valid releases. There is no hidden private key in
the repository or runtime. Downloads and trust-material refresh require network
access; failed verification leaves the previous runtime in place.

Updates are staged, reject archive path traversal/oversized expansion, retain
versioned runtimes and switch the stable extension directory before requesting
`chrome.runtime.reload()`. A failed directory switch restores the backup.
Unexpected interruption may require the agent's local recovery; the design
does not promise a multi-file filesystem transaction across all operating systems.
No running host executable is overwritten. Native wire version 1 is shared by
host and extension; incompatible manifests are refused.

User data: `~/.webmcp-bridge-ext/{auth.json,current.json,runner.cjs,extension,versions}`.
Native registration uses the user's Chrome/Chromium NativeMessagingHosts
folder on macOS/Linux and HKCU registration on Windows. The executable runtime
path is captured at installation; removing that Node/Bun installation requires
running the installer again. The CLI's `config` output contains no credentials.

## Build and tests

```bash
bun install
bun run check
bun run build
bun run test
bun scripts/artifacts.ts
bun x playwright install chromium
bun run test:browser
```

`dist/` and archives stay out of git. CI checks this, validates the skill and
examples, and exercises framing, policy, stale refs, schema validation, archive
safety and an actual MCP HTTP/IPC exchange. Browser tests load a disposable
extension copy pre-authorized only for a loopback fixture, test popup/native-host
integration and persistence, and attempt native WebMCP execution when Chromium
exposes the target API. A missing native API is reported explicitly, not counted
as a successful native execution test.

For local development only, a reviewed runtime ZIP built from this checkout can
be installed with `install --local-archive artifacts/runtime.zip`. That is an
explicit local developer operation; automatic updates and normal installation
always require signed release verification.

Publishing requires npm scope/package authorization: configure `NPM_TOKEN` as
a repository secret or the npm trusted-publisher relationship. Those publisher
credentials never become an operator setup requirement. Release signing uses
GitHub Actions OIDC rather than a stored signing secret.
