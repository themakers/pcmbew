# Add pcmbew to a SPA

This is the **website developer's** task. An operator visiting a site that
already supports pcmbew only needs the Console commands in [the skill](../SKILL.md).
Do not ask them to modify production source code.

## Contents

- [Install and initialize](#install-and-initialize)
- [Register application capabilities](#register-application-capabilities)
- [Understand the two functions](#understand-the-two-functions)
- [Framework and session lifecycle](#framework-and-session-lifecycle)
- [Authentication and browser policy](#authentication-and-browser-policy)
- [Acceptance test](#acceptance-test)

## Install and initialize

Configure GitHub Packages as described in the skill. In the SPA project:

```bash
bun add @themakers/pcmbew@0.1.0
```

Create a browser-only bootstrap module, for example `src/agent.ts`. Call the
imported function **once during application startup**, after the application
services needed by your tools are ready:

```typescript
import { pcmbew } from "@themakers/pcmbew";

pcmbew(async (mcp) => {
  mcp.registerTool(
    "pcmbew_status",
    {
      description: "Check this page's connection context without reading private records.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          origin: location.origin,
          page: location.pathname,
          title: document.title,
        }),
      }],
    }),
  );
});
```

Import that bootstrap module from the SPA's **client entrypoint**, not a server
rendering entrypoint. Importing the package alone does not install the global
switch: the application must actually call `pcmbew(callback)`. Keep registration
light; the browser connects only after the callback completes. Do not wait
for an MCP connection inside the callback itself.

`pcmbew_status` above reports page context, not identity or authorization.
The application may provide an explicitly designed, low-sensitivity account
status tool when the operator must verify tenant/account selection. Do not
return cookies, bearer tokens or full private profiles from a status tool.

## Register application capabilities

Register tools over the same application services the normal UI uses. That
keeps API URLs, CSRF handling, refresh logic and error mapping in one place.
Prefer `search_orders` and `get_order` to `fetch_any_url` or `execute_js`.

For a typed example, add Zod as a **direct SPA dependency** instead of relying
on a transitive SDK dependency:

```bash
bun add zod@^3.25.0
```

The following is a complete alternative bootstrap, with an illustrative
same-origin `/api/orders/:id` endpoint. Replace that endpoint with the real
application service and expose only data needed for the task:

```typescript
import { pcmbew } from "@themakers/pcmbew";
import { z } from "zod";

pcmbew(async (mcp) => {
  mcp.registerTool(
    "get_order",
    {
      description: "Read one order allowed for the currently signed-in account.",
      inputSchema: { id: z.string().min(1).max(128) },
      annotations: { readOnlyHint: true },
    },
    async ({ id }, { signal }) => {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
        signal,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Order lookup failed: HTTP ${response.status}` }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(await response.json()) }],
      };
    },
  );
});
```

The backend must authorize the object for the current user on **every**
request. A schema, tool description or `readOnlyHint` is not an authorization
boundary. Mutation tools need the application's existing permissions, CSRF
protections and appropriate user confirmation. Use application/backend
idempotency keys where duplicate writes matter; pcmbew supplies no
exactly-once execution guarantee.

## Understand the two functions

| Function | Caller | Meaning |
| --- | --- | --- |
| Imported `pcmbew(async mcp => { ... })` | SPA bootstrap | Install the runtime global switch and save the startup callback. |
| Global `pcmbew(38471)` | Operator in this page's Console | Stop any previous instance, create a fresh `McpServer`, run the callback, then connect to local port 38471. |
| Global `pcmbew()` | Operator or app session teardown | Stop this browser-side instance and its retries. |

The imported function accepts a callback, **not a port**. The global switch
accepts a port, **not a callback**. Module-local imports do not normally shadow
the runtime global in a separate DevTools Console; `globalThis.pcmbew(38471)`
is the explicit form when there is ambiguity.

The startup callback may be async. It runs once per explicit start and can
register tools after awaiting app initialization. Throwing from it stops that
start and logs `pcmbew:` in the browser Console. It is not rerun for ordinary
WebSocket reconnect attempts. Both exported/global functions return `void`;
`await pcmbew(port)` cannot prove that a connection is ready.

## Framework and session lifecycle

Install in a singleton browser bootstrap or an equivalent mount hook with a
deliberate cleanup. Avoid calling the imported installer on every React render,
route transition or store update: reinstalling it stops the previous global
instance. With SSR, execute only in the client runtime. Review development
Strict Mode/HMR behavior so hot reloads do not look like inexplicable sessions
ending.

At logout, tenant/account switch and application teardown, call
`globalThis.pcmbew?.()` where appropriate. Logout by itself does not necessarily
close a WebSocket in a SPA. Existing handlers should resolve the **current**
authenticated context at invocation time instead of retaining old tokens or
account state captured at registration.

A full document reload removes the active instance. Have the operator run
the Console start again and reconnect/restart the harness's MCP server.
Keeping the same WebSocket port does not preserve MCP initialization across
a newly created server. Do not retry uncertain writes during this process.

## Authentication and browser policy

The tool executes inside the page; its app service or same-origin `fetch`
uses the browser's normal session behavior. `HttpOnly` cookies need not be
read by JavaScript for the browser to send them. Do not copy credentials into
the local proxy. Cross-origin APIs still require the application's normal
credentials/CORS/cookie configuration; pcmbew does not bypass those controls.

The browser connects to `ws://127.0.0.1:<port>`. Allow the chosen endpoint in
the site's **existing** CSP `connect-src` when needed, preserving its other
required destinations. For example, the extra source expression for the
sample port is `ws://127.0.0.1:38471`; it is not a whole replacement CSP policy.

Test the actual HTTPS deployment and target browser. Mixed-content, local
network, managed-browser and CSP rules can affect a loopback WebSocket and
change between browser versions. The CLI does not provide TLS/WSS. Do not
recommend disabling browser protections as a deployment strategy. Native
WebMCP support, an extension or Chrome experimental flags are not a library
requirement.

Sources: [Fetch credentials](https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials),
[CSP connect-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src),
[official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Acceptance test

Use a test account and a low-sensitivity tool. Verify all of the following:

1. Without activation, loading the page does not start a loopback connection.
2. `typeof globalThis.pcmbew` is `"function"` in the intended frame.
3. `pcmbew(38471)` runs registration once and retries while the bridge is absent.
4. Starting the harness-owned bridge yields initialization, tool discovery
   and a successful harmless read in the intended account context.
5. `pcmbew()` stops browser retries. Stopping the harness server kills the
   bridge and discards pending input; a fresh start requires a fresh check.
6. Reload, logout and account/tenant switch do not silently grant a new context
   to the old agent session. Test the actual application teardown behavior.

Report which steps were exercised. A TypeScript build or a fake WebSocket
unit test is not an end-to-end test in the deployed browser.
