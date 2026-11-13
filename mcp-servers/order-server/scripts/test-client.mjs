import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(root, "src", "server.mjs")],
  cwd: root,
  stderr: "pipe"
});
const client = new Client({
  name: "agentforge-mcp-test",
  version: "0.1.0"
});

await client.connect(transport);
const tools = await client.listTools();
console.log(
  JSON.stringify(
    tools.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      annotations: tool.annotations
    })),
    null,
    2
  )
);

const order = await client.callTool({
  name: "get_order",
  arguments: { order_id: "ORD-2026-1042" }
});
console.log(JSON.stringify(order.structuredContent, null, 2));
await client.close();
