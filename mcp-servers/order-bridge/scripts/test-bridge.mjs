import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import { createBridgeServer, loadConfig } from "../src/bridge.mjs";
import { createOrderHttpServer } from "../../order-server/src/http-server.mjs";

const root = resolve(import.meta.dirname, "..", "..");
const token = "test-bridge-token";
const orderHttpServer = createOrderHttpServer();
orderHttpServer.listen(0, "127.0.0.1");
await once(orderHttpServer, "listening");
const orderHttpPort = orderHttpServer.address().port;
process.env.MCP_ORDER_HTTP_URL =
  `http://127.0.0.1:${orderHttpPort}/mcp`;
const config = await loadConfig(resolve(root, "bridge.config.json"));
const server = createBridgeServer({
  config,
  token,
  logger: { error: () => undefined }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address();
const headers = {
  "Content-Type": "application/json",
  "X-Bridge-Token": token
};

const health = await fetch(`http://127.0.0.1:${port}/health`);
assert.equal(health.status, 200);

const unauthorized = await fetch(
  `http://127.0.0.1:${port}/api/mcp/servers`
);
assert.equal(unauthorized.status, 401);

const discover = await fetch(
  `http://127.0.0.1:${port}/api/mcp/servers/order-server/discover`,
  { method: "POST", headers }
);
assert.equal(discover.status, 200);
const discovered = await discover.json();
assert.equal(discovered.tools.length, 4);
assert.equal(
  discovered.tools.find((tool) => tool.name === "get_order").readOnly,
  true
);
assert.equal(
  discovered.tools.find((tool) => tool.name === "issue_refund")
    .requiresApproval,
  true
);

const call = await fetch(
  `http://127.0.0.1:${port}/api/mcp/servers/order-server/tools/get_order/call`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      arguments: { order_id: "ORD-2026-1042" }
    })
  }
);
assert.equal(call.status, 200);
const result = await call.json();
assert.equal(result.ok, true);
assert.equal(result.structuredContent.id, "ORD-2026-1042");

const healthCheck = await fetch(
  `http://127.0.0.1:${port}/api/mcp/servers/order-server/health`,
  { method: "POST", headers }
);
assert.equal(healthCheck.status, 200);
assert.equal((await healthCheck.json()).status, "healthy");

const remoteDiscover = await fetch(
  `http://127.0.0.1:${port}/api/mcp/servers/order-http-server/discover`,
  { method: "POST", headers }
);
assert.equal(remoteDiscover.status, 200);
const remoteTools = await remoteDiscover.json();
assert.equal(remoteTools.transport, "streamable-http");
assert.equal(remoteTools.tools.length, 4);

const remoteCall = await fetch(
  `http://127.0.0.1:${port}/api/mcp/servers/order-http-server/tools/get_order/call`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({
      arguments: { order_id: "ORD-2026-1120" }
    })
  }
);
assert.equal(remoteCall.status, 200);
const remoteResult = await remoteCall.json();
assert.equal(remoteResult.structuredContent.id, "ORD-2026-1120");

const blocked = await fetch(
  `http://127.0.0.1:${port}/api/mcp/servers/order-server/tools/delete_everything/call`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({ arguments: {} })
  }
);
assert.equal(blocked.status, 403);

console.log(
  JSON.stringify(
    {
      bridge: "ok",
      tools: discovered.tools.map((tool) => tool.name),
      order: result.structuredContent,
      allowlist: "enforced",
      persistentSession: "healthy",
      streamableHttp: "healthy",
      remoteToolCall: remoteResult.structuredContent.id
    },
    null,
    2
  )
);

server.close();
orderHttpServer.closeAllConnections?.();
orderHttpServer.close();
