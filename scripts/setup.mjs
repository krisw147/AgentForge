import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const isWindows = platform() === "win32";
const npmCli = process.env.npm_execpath;

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findPython() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const candidates = isWindows ? ["python"] : ["python3", "python"];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error(
    "Python was not found. Install Python 3.8+ or set the PYTHON environment variable."
  );
}

function installNodeProject(path) {
  if (!npmCli) {
    throw new Error("Run this setup through: npm run setup");
  }
  run(process.execPath, [npmCli, "ci", "--prefix", path]);
}

const python = findPython();
const venvPython = isWindows
  ? resolve(root, ".venv", "Scripts", "python.exe")
  : resolve(root, ".venv", "bin", "python");

if (!existsSync(venvPython)) {
  run(python, ["-m", "venv", ".venv"]);
}

run(venvPython, [
  "-m",
  "pip",
  "install",
  "-r",
  "apps/api/requirements.txt"
]);
installNodeProject("apps/web");
installNodeProject("mcp-servers/order-server");
installNodeProject("mcp-servers/order-bridge");

console.log(
  "\nAgentForge dependencies are ready. Start the platform with: npm run dev"
);
