import os
import sys
import tempfile
from pathlib import Path

# Isolate tests from the demo database: point data dir + DB at a temp folder BEFORE importing sitesync.
_TMP = Path(tempfile.mkdtemp(prefix="sitesync_test_"))
os.environ["SITESYNC_DATA_DIR"] = str(_TMP)
os.environ["SITESYNC_DB"] = str(_TMP / "test.db")
os.environ.pop("ANTHROPIC_API_KEY", None)  # tests always exercise the offline path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def seeded():
    from sitesync.services.seeding import seed

    return seed(regenerate=True, verbose=False)


@pytest.fixture(scope="session")
def client(seeded):
    from fastapi.testclient import TestClient

    from sitesync.api import app

    with TestClient(app) as c:
        yield c
