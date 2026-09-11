import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { credential } from "./local";
import { connectBroker } from "./connector";
import { VERSION, TOOLS, failure } from "./shared";
export async function stdio() {
  const probe = await connectBroker(); probe.destroy();
  let client: Client | undefined;
  let opening: Promise<Client> | undefined;
  async function connected() {
    if (client) return client;
    if (!opening) opening = (async () => {
      const probe = await connectBroker(); probe.destroy();
      const c = new Client({ name: "webmcp-bridge-ext-stdio", version: VERSION });
      try { await c.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8777/mcp"), { requestInit: { headers: { Authorization: "Bearer " + credential() } } })); }
      catch (e) { await c.close().catch(() => {}); throw e; }
      c.onclose = () => { if (client === c) client = undefined; };
      client = c; return c;
    })().finally(() => { opening = undefined; });
    return opening;
  }
  const server = new Server({ name: "webmcp-bridge-ext", version: VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (r, extra) => {
    let c: Client | undefined;
    try { c = await connected(); return await c.callTool(r.params, undefined, { signal: extra.signal, timeout: 130000 }) as any; }
    catch (e) {
      // Discard a broken HTTP session, but never replay this invocation.
      if (client === c) client = undefined;
      await c?.close().catch(() => {});
      return { isError: true, content: [{ type: "text", text: JSON.stringify(failure(e)) }] };
    }
  });
  server.onclose = () => { void client?.close(); };
  await server.connect(new StdioServerTransport());
}
