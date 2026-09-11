import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";

declare global {
  var pcmbew: (port?: number) => void;
}

export function pcmbew(start: (mcp: McpServer) => void | Promise<void>): void {
  globalThis.pcmbew?.();
  let stop = () => {};

  globalThis.pcmbew = (port?: number) => {
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new RangeError("pcmbew port must be 1..65535");
    }
    stop();
    if (port === undefined) return;

    const mcp = new McpServer({ name: "pcmbew", version: "0.1.1" });
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const shutdown = () => {
      active = false;
      clearTimeout(timer);
      void mcp.close().catch(error => console.error("pcmbew:", error));
    };
    stop = shutdown;

    const retry = () => {
      if (!active) return;
      clearTimeout(timer);
      timer = setTimeout(connect, 1000);
    };

    const connect = async () => {
      if (!active) return;
      try {
        await mcp.connect(new WebSocketClientTransport(new URL(`ws://127.0.0.1:${port}`)));
      } catch {
        await mcp.close().catch(() => {});
        retry();
      }
    };

    mcp.server.onclose = retry;
    void Promise.resolve().then(() => { if (active) return start(mcp); })
      .then(connect).catch(error => {
        shutdown();
        console.error("pcmbew:", error);
      });
  };
}
