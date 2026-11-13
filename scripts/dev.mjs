import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { platform } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const isWindows = platform() === "win32";
const withoutWorker = process.argv.includes("--no-worker");
const python = isWindows
  ? resolve(root, ".venv", "Scripts", "python.exe")
  : resolve(root, ".venv", "bin", "python");
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
  console.error("Run: python -m venv .venv");
  console.error("Then: .venv/Scripts/python -m pip install -r apps/api/requirements.txt");
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
    isWindows ? "npm.cmd" : "npm",
    ["--prefix", "apps/web", "run", "dev"],
    { cwd: root, stdio: "inherit", env: process.env, shell: isWindows }
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

