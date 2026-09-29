"""Create a local virtualenv (.venv) and install backend dependencies.

Usage:  python scripts/setup.py
Cross-platform (Windows / macOS / Linux). Idempotent.
"""
import os
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENV = ROOT / ".venv"


def venv_python() -> Path:
    if os.name == "nt":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def main() -> None:
    if sys.version_info < (3, 10):
        sys.exit("Python 3.10+ is required")
    if not venv_python().exists():
        print(f"[setup] creating virtualenv at {VENV}")
        venv.EnvBuilder(with_pip=True).create(VENV)
    py = str(venv_python())
    subprocess.check_call([py, "-m", "pip", "install", "--upgrade", "pip", "-q"])
    subprocess.check_call([py, "-m", "pip", "install", "-q", "-r", str(ROOT / "backend" / "requirements.txt")])
    print("[setup] backend dependencies installed. Next: npm run seed && npm run dev")


if __name__ == "__main__":
    main()
