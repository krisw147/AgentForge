import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { platform } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const isWindows = platform() === "win32";
const withoutWorker = process.argv.includes("--no-worker");
const python = isWindows
  ? resolve(root, ".venv", "Scripts", "python.exe")
  : resolve(root, ".venv", "bin", "python");
const webRoot = resolve(root, "apps", "web");
const bridgeToken =
  process.env.MCP_BRIDGE_TOKEN || randomBytes(24).toString("hex");
const serviceEnv = {
  ...process.env,
  MCP_BRIDGE_URL:
    process.env.MCP_BRIDGE_URL || "http://127.0.0.1:8765",
  MCP_BRIDGE_TOKEN: bridgeToken,
  AGENTFORGE_MCP_BRIDGE_URL:
    process.env.AGENTFORGE_MCP_BRIDGE_URL || "http://127.0.0.1:8765",
  AGENTFORGE_MCP_BRIDGE_TOKEN:
    process.env.AGENTFORGE_MCP_BRIDGE_TOKEN || bridgeToken
};

if (!existsSync(python)) {
  console.error("Python virtual environment is missing.");
  console.error("Run: npm run setup");
  process.exit(1);
}

for (const dependencyPath of [
  resolve(webRoot, "node_modules", "next"),
  resolve(root, "mcp-servers", "order-server", "node_modules"),
  resolve(root, "mcp-servers", "order-bridge", "node_modules")
]) {
  if (!existsSync(dependencyPath)) {
    console.error(`Missing JavaScript dependencies: ${dependencyPath}`);
    console.error("Run: npm run setup");
    process.exit(1);
  }
}

function isAddressOccupied(host, port) {
  return new Promise((resolveAvailability) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (occupied) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveAvailability(occupied);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function isPortAvailable(port) {
  const ipv4Occupied = await isAddressOccupied("127.0.0.1", port);
  const ipv6Occupied = await isAddressOccupied("::1", port);
  return !ipv4Occupied && !ipv6Occupied;
}

const requiredPorts = [
  [3000, "Web"],
  [8000, "API"],
  [8765, "MCP Bridge"],
  [8766, "HTTP MCP Server"]
];
const occupiedPorts = [];
for (const [port, label] of requiredPorts) {
  if (!(await isPortAvailable(port))) occupiedPorts.push({ port, label });
}
if (occupiedPorts.length > 0) {
  console.error("AgentForge cannot start because required ports are in use:");
  for (const { port, label } of occupiedPorts) {
    console.error(`- ${port}: ${label}`);
  }
  console.error("Stop the existing service and run npm run dev again.");
  process.exit(1);
}

const children = [
  spawn(
    python,
    [
      "-m",
      "uvicorn",
      "app.main:app",
      "--app-dir",
      "apps/api",
      "--host",
      "127.0.0.1",
      "--port",
      "8000"
    ],
    { cwd: root, stdio: "inherit", env: serviceEnv }
  ),
  spawn(
    process.execPath,
    [resolve(root, "mcp-servers", "order-bridge", "src", "server.mjs")],
    {
      cwd: resolve(root, "mcp-servers", "order-bridge"),
      stdio: "inherit",
      env: serviceEnv
    }
  ),
  spawn(
    process.execPath,
    [resolve(root, "mcp-servers", "order-server", "src", "http-server.mjs")],
    {
      cwd: resolve(root, "mcp-servers", "order-server"),
      stdio: "inherit",
      env: serviceEnv
    }
  ),
  spawn(
    process.execPath,
    [resolve(webRoot, "node_modules", "next", "dist", "bin", "next"), "dev"],
    { cwd: webRoot, stdio: "inherit", env: process.env }
  )
];

if (!withoutWorker) {
  children.splice(
    1,
    0,
    spawn(python, ["-m", "app.worker"], {
      cwd: resolve(root, "apps", "api"),
      stdio: "inherit",
      env: serviceEnv
    })
  );
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 150);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!shuttingDown && code && code !== 0) shutdown(code);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

