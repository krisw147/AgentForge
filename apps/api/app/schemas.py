from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class AgentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = ""
    icon: str = "AF"
    color: str = "violet"
    model: str = "demo-deterministic"
    system_prompt: str
    budget_cents: int = Field(default=20, ge=1, le=1000)
    max_steps: int = Field(default=8, ge=1, le=30)


class AgentVersionCreate(BaseModel):
    version: Optional[str] = None
    model: str = "demo-deterministic"
    system_prompt: str
    budget_cents: int = Field(default=20, ge=1, le=1000)
    max_steps: int = Field(default=8, ge=1, le=30)
    config: dict = {}


class RunCreate(BaseModel):
    agent_id: str
    version_id: Optional[str] = None
    input: str = Field(min_length=1, max_length=8000)
    fault_mode: str = ""


class ApprovalDecision(BaseModel):
    approved: bool
    note: str = ""


class EvalRunCreate(BaseModel):
    agent_id: str
    dataset_id: str
    version_id: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class SwitchWorkspaceRequest(BaseModel):
    slug: str


class ReleaseCheckRequest(BaseModel):
    dataset_id: str
    min_accuracy: float = Field(default=0.9, ge=0, le=1)
    max_p95_latency_ms: int = Field(default=2000, ge=1, le=120000)
    max_avg_cost_cents: float = Field(default=2.0, ge=0, le=1000)


class MCPImportRequest(BaseModel):
    bridge_server_id: str = Field(min_length=1, max_length=120)


class SetAgentToolsRequest(BaseModel):
    tool_ids: List[str] = []

