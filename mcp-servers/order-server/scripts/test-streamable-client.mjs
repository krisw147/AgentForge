import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { once } from "node:events";
import { createOrderHttpServer } from "../src/http-server.mjs";

const server = createOrderHttpServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address();
const transport = new StreamableHTTPClientTransport(
  new URL(`http://127.0.0.1:${port}/mcp`)
);
const client = new Client({
  name: "agentforge-http-test",
  version: "0.1.0"
});
await client.connect(transport);
const tools = await client.listTools();
const result = await client.callTool({
  name: "get_order",
  arguments: { order_id: "ORD-2026-1120" }
});
if (tools.tools.length !== 4 || result.structuredContent.id !== "ORD-2026-1120") {
  throw new Error("Streamable HTTP MCP test failed");
}
console.log(
  JSON.stringify(
    {
      transport: "streamable-http",
      tools: tools.tools.length,
      order: result.structuredContent
    },
    null,
    2
  )
);
await client.close();
server.closeAllConnections?.();
server.close();
