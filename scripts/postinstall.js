#!/usr/bin/env node
// Runs after `npm install` at the repo root: installs frontend deps, then sets up the Python venv.
// A Python failure is reported but does not fail the npm install (run `npm run setup` to retry).
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

console.log("[postinstall] installing frontend dependencies...");
let r = spawnSync(npm, ["install", "--no-audit", "--no-fund"], { cwd: path.join(root, "frontend"), stdio: "inherit", shell: process.platform === "win32" });
if (r.status !== 0) process.exit(r.status ?? 1);

if (process.env.SITESYNC_SKIP_PYTHON) {
  console.log("[postinstall] SITESYNC_SKIP_PYTHON set - skipping Python setup");
  process.exit(0);
}
console.log("[postinstall] setting up Python backend (.venv)...");
r = spawnSync(process.execPath, [path.join(__dirname, "setup-python.js")], { cwd: root, stdio: "inherit" });
if (r.status !== 0) {
  console.warn("[postinstall] Python setup did not complete. Fix Python, then run: npm run setup");
}
process.exit(0);
