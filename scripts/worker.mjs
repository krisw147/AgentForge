import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const isWindows = platform() === "win32";
const python = isWindows
  ? resolve(root, ".venv", "Scripts", "python.exe")
  : resolve(root, ".venv", "bin", "python");

if (!existsSync(python)) {
  console.error("Python virtual environment is missing.");
  process.exit(1);
}

const worker = spawn(python, ["-m", "app.worker"], {
  cwd: resolve(root, "apps", "api"),
  stdio: "inherit",
  env: process.env
});

const shutdown = () => {
  if (!worker.killed) worker.kill();
};

worker.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

