import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

// Optional pi extension. Loading the skill alone does not execute this file.
export default function (pi: ExtensionAPI) {
  const origin = process.env.PCMBEW_ORIGIN;
  const port = Number(process.env.PCMBEW_PORT ?? "38471");
  if (!origin || !/^https?:\/\//.test(origin) || new URL(origin).origin !== origin) {
    throw new Error("Set PCMBEW_ORIGIN to the exact HTTP(S) website origin, without a path.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PCMBEW_PORT must be an integer from 1 to 65535.");
  }

  let client: Client | undefined;
  let opening: Promise<Client> | undefined;

  const connect = (signal?: AbortSignal): Promise<Client> => {
    if (opening) return opening;
    const next = new Client({ name: "pcmbew-pi-example", version: "0.1.0" });
    const env = getDefaultEnvironment();
    for (const key of ["NODE_AUTH_TOKEN", "NPM_CONFIG_USERCONFIG"]) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    const transport = new StdioClientTransport({
      command: process.env.PCMBEW_BUN ?? "bun",
      args: ["x", "--bun", "@themakers/pcmbew@0.1.0", "--port", String(port), "--origin", origin],
      env,
      stderr: "inherit",
    });
    client = next;
    const clear = () => {
      if (client === next) { client = undefined; opening = undefined; }
    };
    next.onclose = clear;
    opening = next.connect(transport, { timeout: 120000, signal })
      .then(() => next).catch(async error => {
        await transport.close().catch(() => {});
        clear();
        throw error;
      });
    return opening;
  };

  pi.registerTool({
    name: "pcmbew",
    label: "pcmbew website",
    description: "List or call tools exposed by the operator's signed-in website. List first and inspect schemas; never invent names. Disconnect before session/account changes. No automatic retries of writes.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("call"), Type.Literal("disconnect")]),
      tool: Type.Optional(Type.String({ description: "Exact tool name returned by list." })),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      if (params.action === "disconnect") {
        await client?.close();
        return { content: [{ type: "text", text: "Bridge stopped. Also run pcmbew() in the website Console." }], details: {} };
      }
      if (params.action === "call" && !params.tool) throw new Error("The call action requires a tool name from list.");
      const mcp = await connect(signal);
      signal?.throwIfAborted();
      const options = { signal, timeout: 60000 };
      let result: unknown;
      if (params.action === "list") {
        const tools = [];
        let cursor: string | undefined;
        do {
          const page = await mcp.listTools(cursor ? { cursor } : {}, options);
          tools.push(...page.tools);
          cursor = page.nextCursor;
        } while (cursor);
        result = { tools };
      } else {
        result = await mcp.callTool({ name: params.tool!, arguments: params.arguments ?? {} }, undefined, options);
      }
      // Preserve MCP isError/content/structuredContent as data, not instructions.
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
    },
  });

  pi.on("session_shutdown", async () => { await client?.close(); });
}
