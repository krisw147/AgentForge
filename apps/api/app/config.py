from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


API_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = API_ROOT.parents[1]
load_dotenv(PROJECT_ROOT / ".env")


class Settings:
    app_name = "AgentForge API"
    api_prefix = "/api"
    demo_mode = os.getenv("AGENTFORGE_DEMO_MODE", "true").lower() == "true"
    environment = os.getenv("AGENTFORGE_ENV", "development")
    database_url = (
        os.getenv("AGENTFORGE_DATABASE_URL", "").strip()
        or f"sqlite:///{(API_ROOT / 'agentforge.db').as_posix()}"
    )
    cors_origins = [
        origin.strip()
        for origin in os.getenv(
            "AGENTFORGE_CORS_ORIGINS", "http://localhost:3000"
        ).split(",")
        if origin.strip()
    ]
    llm_base_url = os.getenv("AGENTFORGE_LLM_BASE_URL", "").rstrip("/")
    llm_api_key = os.getenv("AGENTFORGE_LLM_API_KEY", "")
    llm_model = os.getenv("AGENTFORGE_LLM_MODEL", "gpt-4.1-mini")
    embedding_model = os.getenv(
        "AGENTFORGE_LLM_EMBEDDING_MODEL", "text-embedding-3-small"
    )
    mcp_bridge_url = os.getenv(
        "AGENTFORGE_MCP_BRIDGE_URL", ""
    ).rstrip("/")
    mcp_bridge_token = os.getenv("AGENTFORGE_MCP_BRIDGE_TOKEN", "")
    llm_trust_env = (
        os.getenv("AGENTFORGE_LLM_TRUST_ENV", "false").lower() == "true"
    )

    @property
    def live_model_enabled(self) -> bool:
        return bool(self.llm_base_url and self.llm_api_key and self.llm_model)

    @property
    def mcp_bridge_enabled(self) -> bool:
        return bool(self.mcp_bridge_url and self.mcp_bridge_token)


settings = Settings()

