# pcmbew

Tiny protocol-opaque stdio ↔ WebSocket bridge. The MCP server runs inside your SPA, in the user's authenticated browser session.

```text
harness -- stdio --> pcmbew -- WebSocket --> SPA / McpServer --> app API
```

The CLI never parses MCP or JSON. Without a connected browser it does not answer: incoming stdio lines simply wait.

## Run

GitHub Packages requires registry authentication:

```ini
@themakers:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```sh
bun x --bun @themakers/pcmbew --port 38471
npx --yes @themakers/pcmbew --port 38471
```

Optionally pin the browser origin:

```sh
bun x --bun @themakers/pcmbew --port 38471 --origin https://app.example.com
```

## SPA

```sh
bun add @themakers/pcmbew
```

```ts
import { pcmbew } from "@themakers/pcmbew";

pcmbew(async mcp => {
  // register tools here
});
```

The library installs a runtime global switch but does nothing until the operator uses DevTools:

```js
pcmbew(38471) // start
pcmbew()      // stop
```

The callback runs once per explicit start, before connecting. While active, reconnect attempts happen once per second. Stopping cancels reconnects.

The proxy binds only `127.0.0.1`, allows one browser at a time, and validates browser `Origin`. With no `--origin`, the first accepted origin is pinned for the process lifetime. This is TOFU, not authentication; use `--origin` outside local experimentation.

All tooling/builds use Bun. The CLI build targets Node >=20 so `npx` works without Bun installed.

MIT.
