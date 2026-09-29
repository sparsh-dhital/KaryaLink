#!/usr/bin/env node
// Finds a Python 3.10+ interpreter and runs scripts/setup.py (creates .venv + installs backend deps).
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const candidates = process.platform === "win32" ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];

function works(cmd, pre) {
  const r = spawnSync(cmd, [...pre, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"], { stdio: "ignore" });
  return r.status === 0;
}

const found = candidates.find(([cmd, pre]) => works(cmd, pre));
if (!found) {
  console.error("[setup] Python 3.10+ not found on PATH. Install it, then run: npm run setup");
  process.exit(1);
}
const [cmd, pre] = found;
const r = spawnSync(cmd, [...pre, path.join(root, "scripts", "setup.py")], { stdio: "inherit", cwd: root });
process.exit(r.status ?? 1);
