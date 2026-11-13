from __future__ import annotations

import os
import sys
from pathlib import Path


TEST_DB = Path(__file__).resolve().parent / "test-agentforge.db"
if TEST_DB.exists():
    TEST_DB.unlink()

os.environ["AGENTFORGE_DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["AGENTFORGE_DEMO_MODE"] = "true"
os.environ.pop("AGENTFORGE_LLM_API_KEY", None)
os.environ.pop("AGENTFORGE_LLM_BASE_URL", None)

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

