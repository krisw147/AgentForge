import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createBridgeServer, loadConfig } from "./bridge.mjs";

const root = resolve(import.meta.dirname, "..", "..");
const configPath =
  process.env.MCP_BRIDGE_CONFIG || resolve(root, "bridge.config.json");
const config = await loadConfig(configPath);
const token =
  process.env.MCP_BRIDGE_TOKEN || randomBytes(24).toString("hex");
const port = Number(process.env.MCP_BRIDGE_PORT || 8765);
const host = process.env.MCP_BRIDGE_HOST || "127.0.0.1";
const server = createBridgeServer({ config, token });

server.listen(port, host, () => {
  console.error(
    JSON.stringify({
      service: "agentforge-mcp-bridge",
      status: "ready",
      host,
      port,
      tokenGenerated: !process.env.MCP_BRIDGE_TOKEN
    })
  );
});

