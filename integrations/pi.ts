import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "@sinclair/typebox";
import { credential } from "../src/local";
import { connectBroker } from "../src/connector";
import { TOOLS, VERSION } from "../src/shared";
// Optional pi extension; it registers the same five stable tools, not a sixth router.
export default function(pi: { registerTool(tool: any): void; on(event: "session_shutdown", handler: () => Promise<void>): void }) {
  let client: Client | undefined, opening: Promise<Client> | undefined;
  async function connected() {
    if (client) return client;
    if (!opening) opening = (async () => {
      const probe = await connectBroker(); probe.destroy();
      const c = new Client({ name: "webmcp-bridge-ext-pi", version: VERSION });
      try { await c.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8777/mcp"), { requestInit: { headers: { Authorization: "Bearer " + credential() } } })); }
      catch (e) { await c.close().catch(() => {}); throw e; }
      c.onclose = () => { if (client === c) client = undefined; }; client = c; return c;
    })().finally(() => { opening = undefined; });
    return opening;
  }
  for (const tool of TOOLS) pi.registerTool({ name: tool.name, label: tool.name.replaceAll("_", " "), description: tool.description, parameters: Type.Unsafe(tool.inputSchema), async execute(_id: string, args: Record<string, unknown>, signal?: AbortSignal) {
    let c: Client | undefined;
    try {
      c = await connected();
      const result = await c.callTool({ name: tool.name, arguments: args }, undefined, { signal, timeout: 130000 });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
    } catch (e) {
      if (client === c) client = undefined;
      await c?.close().catch(() => {});
      throw e; // A later user-directed invocation reconnects; this one is never replayed.
    }
  } });
  pi.on("session_shutdown", async () => { await client?.close(); });
}
