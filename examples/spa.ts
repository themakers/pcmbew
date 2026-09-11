import { pcmbew } from "@themakers/pcmbew";
import { z } from "zod";

pcmbew(async mcp => {
  mcp.tool("get_order", "Read an order visible to the current user", {
    id: z.string().min(1),
  }, async ({ id }, { signal }) => {
    const response = await fetch(`/api/orders/${encodeURIComponent(id)}`, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { content: [{ type: "text", text: JSON.stringify(await response.json()) }] };
  });
});

// DevTools:
// pcmbew(38471) // start
// pcmbew()      // stop
