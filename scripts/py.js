#!/usr/bin/env node
// Runs a Python command using the project virtualenv if present, else system python.
// Usage: node scripts/py.js -m sitesync.seed
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const candidates =
  process.platform === "win32"
    ? [path.join(root, ".venv", "Scripts", "python.exe")]
    : [path.join(root, ".venv", "bin", "python")];
let py = candidates.find((p) => fs.existsSync(p));
if (!py) py = process.platform === "win32" ? "python" : "python3";

const env = { ...process.env, PYTHONPATH: path.join(root, "backend"), PYTHONUTF8: "1" };
const res = spawnSync(py, process.argv.slice(2), { stdio: "inherit", cwd: root, env });
if (res.error) {
  console.error(`[py] failed to launch ${py}: ${res.error.message}. Run "npm run setup" first.`);
  process.exit(1);
}
process.exit(res.status ?? 1);
