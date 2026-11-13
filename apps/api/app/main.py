from __future__ import annotations

import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from statistics import mean
from typing import List, Optional, Tuple

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import settings
from .auth import (
    AuthContext,
    clear_session_cookie,
    create_session,
    get_auth_context,
    require_roles,
    serialize_auth,
    set_session_cookie,
    user_memberships,
    verify_password,
)
from .db import Base, SessionLocal, engine, get_db
from .migrations import ensure_schema
from .models import (
    Agent,
    AgentTool,
    AgentVersion,
    Approval,
    AuthSession,
    EvalDataset,
    EvalResult,
    EvalRun,
    MCPServer,
    ReleaseCheck,
    Run,
    Tenant,
    Tool,
    User,
)
from .schemas import (
    AgentCreate,
    AgentVersionCreate,
    ApprovalDecision,
    EvalRunCreate,
    LoginRequest,
    MCPImportRequest,
    ReleaseCheckRequest,
    RunCreate,
    SetAgentToolsRequest,
    SwitchWorkspaceRequest,
)
from .seed import (
    PRIMARY_TENANT_ID,
    PRIMARY_VERSION_ID,
    seed_database,
    ensure_auth_seed,
    sync_configured_model,
)
from .services.runtime import AgentRuntime
from .services.job_queue import ACTIVE_STATUSES, TERMINAL_STATUSES
from .services.mcp_bridge import MCPBridgeError, mcp_bridge
from .worker import RuntimeWorker


runtime = AgentRuntime()
evaluation_worker = RuntimeWorker(
    worker_id="evaluation-worker",
    lease_seconds=30,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_schema(engine)
    db = SessionLocal()
    try:
        seed_database(db)
        ensure_auth_seed(db)
        sync_configured_model(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Agent runtime, observability and evaluation control plane.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def validate_mutation_origin(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin", "").rstrip("/")
        if origin and origin not in settings.cors_origins:
            return JSONResponse(
                status_code=403, content={"detail": "请求来源不被允许"}
            )
    return await call_next(request)


def parse_json(value: str, fallback):
    try:
        return json.loads(value) if value else fallback
    except (TypeError, json.JSONDecodeError):
        return fallback


def serialize_version(version: AgentVersion) -> dict:
    return {
        "id": version.id,
        "version": version.version,
        "model": version.model,
        "systemPrompt": version.system_prompt,
        "maxSteps": version.max_steps,
        "budgetCents": version.budget_cents,
        "config": parse_json(version.config_json, {}),
        "status": version.status,
        "createdAt": version.created_at,
    }


def serialize_tool(tool: Tool) -> dict:
    return {
        "id": tool.id,
        "slug": tool.slug,
        "name": tool.name,
        "description": tool.description,
        "kind": tool.kind,
        "source": "mcp" if tool.mcp_server_id else "builtin",
        "enabled": tool.enabled,
        "requiresApproval": tool.requires_approval,
        "readOnly": tool.read_only,
        "destructive": tool.destructive,
        "idempotent": tool.idempotent,
        "mcpServerId": tool.mcp_server_id,
        "remoteName": tool.remote_name,
        "schema": parse_json(tool.input_schema_json, {}),
    }


def serialize_mcp_server(db: Session, server: MCPServer) -> dict:
    tool_count = (
        db.query(Tool)
        .filter(
            Tool.mcp_server_id == server.id,
            Tool.enabled.is_(True),
        )
        .count()
    )
    return {
        "id": server.id,
        "bridgeServerId": server.bridge_server_id,
        "name": server.name,
        "transport": server.transport,
        "status": server.status,
        "toolCount": tool_count,
        "lastDiscoveredAt": server.last_discovered_at,
        "lastError": server.last_error,
        "updatedAt": server.updated_at,
    }


def serialize_agent(db: Session, agent: Agent) -> dict:
    versions = sorted(agent.versions, key=lambda item: item.created_at, reverse=True)
    published = next(
        (version for version in versions if version.status == "published"),
        None,
    )
    latest_draft = next(
        (version for version in versions if version.status == "draft"),
        None,
    )
    run_count = db.query(Run).filter(Run.agent_id == agent.id).count()
    return {
        "id": agent.id,
        "name": agent.name,
        "description": agent.description,
        "icon": agent.icon,
        "color": agent.color,
        "status": agent.status,
        "runCount": run_count,
        "versionCount": len(versions),
        "latestVersion": serialize_version(published) if published else None,
        "latestDraft": serialize_version(latest_draft) if latest_draft else None,
        "updatedAt": agent.updated_at,
    }


def serialize_event(event) -> dict:
    return {
        "id": event.id,
        "seq": event.seq,
        "type": event.type,
        "title": event.title,
        "payload": parse_json(event.payload_json, {}),
        "latencyMs": event.latency_ms,
        "createdAt": event.created_at,
    }


def serialize_approval(approval: Optional[Approval]) -> Optional[dict]:
    if not approval:
        return None
    return {
        "id": approval.id,
        "status": approval.status,
        "reason": approval.reason,
        "requestedAt": approval.requested_at,
        "decidedAt": approval.decided_at,
        "decidedBy": approval.decided_by,
        "note": approval.note,
    }


def serialize_run(db: Session, run: Run, detail: bool = False) -> dict:
    agent = db.query(Agent).filter(Agent.id == run.agent_id).first()
    version = (
        db.query(AgentVersion)
        .filter(AgentVersion.id == run.agent_version_id)
        .first()
    )
    body = {
        "id": run.id,
        "status": run.status,
        "input": run.input,
        "output": run.output,
        "intent": run.intent,
        "trigger": run.trigger,
        "faultMode": run.fault_mode,
        "costCents": run.cost_cents,
        "inputTokens": run.input_tokens,
        "outputTokens": run.output_tokens,
        "latencyMs": run.latency_ms,
        "workerId": run.worker_id,
        "attemptCount": run.attempt_count,
        "leaseExpiresAt": run.lease_expires_at,
        "heartbeatAt": run.heartbeat_at,
        "resumeAction": run.resume_action or None,
        "startedAt": run.started_at,
        "finishedAt": run.finished_at,
        "agent": (
            {
                "id": agent.id,
                "name": agent.name,
                "icon": agent.icon,
                "color": agent.color,
            }
            if agent
            else None
        ),
        "version": version.version if version else None,
        "approval": serialize_approval(run.approval),
    }
    if detail:
        body["events"] = [
            serialize_event(event)
            for event in sorted(run.events, key=lambda item: item.seq)
        ]
        body["systemPrompt"] = version.system_prompt if version else ""
        body["model"] = version.model if version else ""
    return body


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "agentforge-api"}


@app.post("/api/auth/login")
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    user = (
        db.query(User)
        .filter(User.email == payload.email.strip().lower())
        .first()
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    memberships = user_memberships(db, user.id)
    if not memberships:
        raise HTTPException(status_code=403, detail="账号没有可访问的工作区")
    membership, tenant = memberships[0]
    session, raw_token = create_session(
        db,
        user,
        tenant.id,
        user_agent=request.headers.get("user-agent", ""),
    )
    set_session_cookie(response, raw_token)
    return serialize_auth(
        AuthContext(
            session=session,
            user=user,
            tenant=tenant,
            role=membership.role,
        ),
        db,
    )


@app.get("/api/auth/me")
def auth_me(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> dict:
    return serialize_auth(auth, db)


@app.get("/api/auth/workspaces")
def auth_workspaces(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> List[dict]:
    return serialize_auth(auth, db)["workspaces"]


@app.post("/api/auth/switch-workspace")
def switch_workspace(
    payload: SwitchWorkspaceRequest,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> dict:
    candidates = user_memberships(db, auth.user.id)
    selected = next(
        (
            (membership, tenant)
            for membership, tenant in candidates
            if tenant.slug == payload.slug
        ),
        None,
    )
    if not selected:
        raise HTTPException(status_code=403, detail="无权访问该工作区")
    membership, tenant = selected
    auth.session.tenant_id = tenant.id
    db.commit()
    return serialize_auth(
        AuthContext(
            session=auth.session,
            user=auth.user,
            tenant=tenant,
            role=membership.role,
        ),
        db,
    )


@app.post("/api/auth/logout")
def logout(
    response: Response,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> dict:
    stored_session = (
        db.query(AuthSession)
        .filter(AuthSession.id == auth.session.id)
        .first()
    )
    if stored_session:
        stored_session.revoked_at = datetime.utcnow()
        db.commit()
    clear_session_cookie(response)
    return {"ok": True}


@app.get("/api/workspaces")
def list_workspaces(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> List[dict]:
    return serialize_auth(auth, db)["workspaces"]


@app.get("/api/system/status")
def system_status(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> dict:
    tenant = auth.tenant
    return {
        "environment": settings.environment,
        "tenant": tenant.name,
        "model": {
            "mode": "live" if settings.live_model_enabled else "demo",
            "provider": runtime.model.provider,
            "name": settings.llm_model,
            "embeddingModel": settings.embedding_model,
        },
        "runtime": {
            "stateStore": "sqlite" if settings.database_url.startswith("sqlite") else "postgresql",
            "checkpointing": True,
            "humanApproval": True,
            "faultInjection": True,
            "durableQueue": True,
            "workerHeartbeat": True,
        },
        "mcpBridge": {
            "configured": mcp_bridge.enabled,
            "url": settings.mcp_bridge_url,
            "status": "configured" if mcp_bridge.enabled else "disabled",
        },
    }


@app.get("/api/dashboard")
def dashboard(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> dict:
    tenant, user = auth.tenant, auth.user
    can_approve = auth.role in {"owner", "approver"}
    base_runs = db.query(Run).filter(Run.tenant_id == tenant.id)
    total_runs = base_runs.count()
    completed = base_runs.filter(Run.status == "completed").count()
    actionable = base_runs.filter(
        Run.status.in_(["completed", "failed", "rejected", "needs_input"])
    ).count()
    pending_approvals = 0
    if can_approve:
        pending_approvals = (
            db.query(Approval)
            .join(Run, Run.id == Approval.run_id)
            .filter(
                Run.tenant_id == tenant.id,
                Approval.status == "pending",
            )
            .count()
        )
    active_agents = (
        db.query(Agent)
        .filter(Agent.tenant_id == tenant.id, Agent.status == "active")
        .count()
    )
    latency_values = [
        item[0]
        for item in base_runs.with_entities(Run.latency_ms)
        .filter(Run.latency_ms > 0)
        .all()
    ]
    total_cost = (
        db.query(func.coalesce(func.sum(Run.cost_cents), 0.0))
        .filter(Run.tenant_id == tenant.id)
        .scalar()
    )
    start = (datetime.utcnow() - timedelta(days=6)).date()
    trend = []
    for offset in range(7):
        day = start + timedelta(days=offset)
        day_runs = base_runs.filter(
            Run.started_at >= datetime.combine(day, datetime.min.time()),
            Run.started_at
            < datetime.combine(day + timedelta(days=1), datetime.min.time()),
        ).count()
        trend.append(
            {
                "date": day.isoformat(),
                "label": ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][
                    day.weekday()
                ],
                "runs": day_runs,
            }
        )

    recent = (
        base_runs.order_by(Run.started_at.desc()).limit(6).all()
    )
    pending = []
    if can_approve:
        pending = (
            db.query(Approval)
            .join(Run, Run.id == Approval.run_id)
            .filter(
                Run.tenant_id == tenant.id,
                Approval.status == "pending",
            )
            .order_by(Approval.requested_at.desc())
            .limit(4)
            .all()
        )
    approval_items = []
    for approval in pending:
        run = db.query(Run).filter(Run.id == approval.run_id).first()
        if run:
            approval_items.append(
                {
                    "approval": serialize_approval(approval),
                    "run": serialize_run(db, run),
                }
            )
    latest_evals = (
        db.query(EvalRun)
        .filter(EvalRun.tenant_id == tenant.id)
        .order_by(EvalRun.created_at.desc())
        .limit(2)
        .all()
    )
    return {
        "tenant": {"id": tenant.id, "name": tenant.name, "slug": tenant.slug},
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": auth.role,
        },
        "stats": {
            "totalRuns": total_runs,
            "completedRuns": completed,
            "successRate": round(completed / actionable, 4) if actionable else 0,
            "activeAgents": active_agents,
            "pendingApprovals": pending_approvals,
            "avgLatencyMs": round(mean(latency_values)) if latency_values else 0,
            "totalCostCents": round(float(total_cost or 0), 2),
        },
        "trend": trend,
        "recentRuns": [serialize_run(db, run) for run in recent],
        "approvalQueue": approval_items,
        "evaluations": [
            {
                "id": item.id,
                "accuracy": item.accuracy,
                "successRate": item.success_rate,
                "p95LatencyMs": item.p95_latency_ms,
                "passedCases": item.passed_cases,
                "totalCases": item.total_cases,
                "createdAt": item.created_at,
            }
            for item in latest_evals
        ],
        "runtime": {
            "model": runtime.model.provider,
            "mode": "live" if settings.live_model_enabled else "demo",
            "status": "healthy",
        },
    }


@app.get("/api/agents")
def list_agents(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> List[dict]:
    tenant = auth.tenant
    agents = (
        db.query(Agent)
        .filter(Agent.tenant_id == tenant.id)
        .order_by(Agent.updated_at.desc())
        .all()
    )
    return [serialize_agent(db, agent) for agent in agents]


@app.post("/api/agents", status_code=201)
def create_agent(
    payload: AgentCreate,
    auth: AuthContext = Depends(require_roles("owner", "member")),
    db: Session = Depends(get_db),
) -> dict:
    tenant = auth.tenant
    now = datetime.utcnow()
    agent = Agent(
        id=str(uuid.uuid4()),
        tenant_id=tenant.id,
        name=payload.name,
        description=payload.description,
        icon=payload.icon[:2],
        color=payload.color,
        status="active",
        created_at=now,
        updated_at=now,
    )
    version = AgentVersion(
        id=str(uuid.uuid4()),
        agent_id=agent.id,
        version="1.0.0",
        model=payload.model,
        system_prompt=payload.system_prompt,
        max_steps=payload.max_steps,
        budget_cents=payload.budget_cents,
        config_json=json.dumps({"temperature": 0.1, "trace": True}),
        status="draft",
        created_at=now,
    )
    db.add(agent)
    db.flush()
    db.add(version)
    tools = db.query(Tool).filter(Tool.tenant_id == tenant.id).all()
    for tool in tools:
        db.add(AgentTool(agent_version_id=version.id, tool_id=tool.id))
    db.commit()
    db.refresh(agent)
    return serialize_agent(db, agent)


@app.get("/api/agents/{agent_id}")
def get_agent(
    agent_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> dict:
    tenant = auth.tenant
    agent = (
        db.query(Agent)
        .filter(Agent.id == agent_id, Agent.tenant_id == tenant.id)
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    latest = agent.versions[0] if agent.versions else None
    tool_ids = []
    if latest:
        tool_ids = [
            item.tool_id
            for item in db.query(AgentTool)
            .filter(AgentTool.agent_version_id == latest.id)
            .all()
        ]
    tools = (
        db.query(Tool).filter(Tool.id.in_(tool_ids)).all() if tool_ids else []
    )
    recent_runs = (
        db.query(Run)
        .filter(Run.agent_id == agent.id)
        .order_by(Run.started_at.desc())
        .limit(8)
        .all()
    )
    version_ids = [version.id for version in agent.versions]
    tool_bindings = {}
    if version_ids:
        binding_rows = (
            db.query(AgentTool)
            .filter(AgentTool.agent_version_id.in_(version_ids))
            .all()
        )
        for version_id in version_ids:
            tool_bindings[version_id] = [
                row.tool_id
                for row in binding_rows
                if row.agent_version_id == version_id
            ]
    checks = (
        db.query(ReleaseCheck)
        .filter(
            ReleaseCheck.agent_id == agent.id,
            ReleaseCheck.tenant_id == tenant.id,
        )
        .order_by(ReleaseCheck.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        **serialize_agent(db, agent),
        "versions": [
            serialize_version(version)
            for version in sorted(
                agent.versions, key=lambda item: item.created_at, reverse=True
            )
        ],
        "tools": [
            serialize_tool(tool)
            for tool in tools
        ],
        "recentRuns": [serialize_run(db, run) for run in recent_runs],
        "toolBindings": tool_bindings,
        "releaseChecks": [
            {
                "id": check.id,
                "agentVersionId": check.agent_version_id,
                "evalRunId": check.eval_run_id,
                "passed": check.passed,
                "minAccuracy": check.min_accuracy,
                "maxP95LatencyMs": check.max_p95_latency_ms,
                "maxAvgCostCents": check.max_avg_cost_cents,
                "actualAccuracy": check.actual_accuracy,
                "actualP95LatencyMs": check.actual_p95_latency_ms,
                "actualAvgCostCents": check.actual_avg_cost_cents,
                "reason": check.reason,
                "createdAt": check.created_at,
            }
            for check in checks
        ],
    }


@app.post("/api/agents/{agent_id}/versions", status_code=201)
def create_version(
    agent_id: str,
    payload: AgentVersionCreate,
    auth: AuthContext = Depends(require_roles("owner", "member")),
    db: Session = Depends(get_db),
) -> dict:
    tenant = auth.tenant
    agent = (
        db.query(Agent)
        .filter(Agent.id == agent_id, Agent.tenant_id == tenant.id)
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    if payload.version:
        version_name = payload.version
    else:
        existing = {
            version.version for version in agent.versions
        }
        patch = len(existing)
        version_name = f"1.{patch}.0"
        while version_name in existing:
            patch += 1
            version_name = f"1.{patch}.0"
    version = AgentVersion(
        id=str(uuid.uuid4()),
        agent_id=agent.id,
        version=version_name,
        model=payload.model,
        system_prompt=payload.system_prompt,
        max_steps=payload.max_steps,
        budget_cents=payload.budget_cents,
        config_json=json.dumps(payload.config, ensure_ascii=False),
        status="draft",
    )
    db.add(version)
    db.flush()
    if agent.versions:
        previous = agent.versions[0]
        previous_tools = (
            db.query(AgentTool)
            .join(Tool, Tool.id == AgentTool.tool_id)
            .filter(
                AgentTool.agent_version_id == previous.id,
                Tool.tenant_id == tenant.id,
                Tool.enabled.is_(True),
            )
            .all()
        )
        for item in previous_tools:
            db.add(
                AgentTool(
                    agent_version_id=version.id,
                    tool_id=item.tool_id,
                )
            )
    agent.updated_at = datetime.utcnow()
    db.commit()
    return serialize_version(version)


@app.put("/api/agents/{agent_id}/versions/{version_id}/tools")
def set_agent_version_tools(
    agent_id: str,
    version_id: str,
    payload: SetAgentToolsRequest,
    auth: AuthContext = Depends(require_roles("owner", "member")),
    db: Session = Depends(get_db),
) -> dict:
    agent = (
        db.query(Agent)
        .filter(
            Agent.id == agent_id,
            Agent.tenant_id == auth.tenant.id,
        )
        .first()
    )
    version = (
        db.query(AgentVersion)
        .filter(
            AgentVersion.id == version_id,
            AgentVersion.agent_id == agent_id,
        )
        .first()
    )
    if not agent or not version:
        raise HTTPException(status_code=404, detail="Agent 或版本不存在")
    if version.status != "draft":
        raise HTTPException(
            status_code=409, detail="只有 Draft 版本可以修改工具绑定"
        )
    tools = (
        db.query(Tool)
        .filter(
            Tool.id.in_(payload.tool_ids),
            Tool.tenant_id == auth.tenant.id,
            Tool.enabled.is_(True),
        )
        .all()
        if payload.tool_ids
        else []
    )
    if len(tools) != len(set(payload.tool_ids)):
        raise HTTPException(status_code=400, detail="包含无效或已停用的工具")
    db.query(AgentTool).filter(
        AgentTool.agent_version_id == version.id
    ).delete(synchronize_session=False)
    for tool in tools:
        db.add(AgentTool(agent_version_id=version.id, tool_id=tool.id))
    agent.updated_at = datetime.utcnow()
    db.commit()
    return {
        "versionId": version.id,
        "tools": [serialize_tool(tool) for tool in tools],
    }


@app.get("/api/tools")
def list_tools(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> List[dict]:
    tenant = auth.tenant
    return [
        serialize_tool(tool)
        for tool in db.query(Tool)
        .filter(Tool.tenant_id == tenant.id)
        .order_by(Tool.name)
        .all()
    ]


def persist_mcp_discovery(
    db: Session,
    tenant_id: str,
    server: MCPServer,
    discovery: dict,
    created_by: str,
) -> List[Tool]:
    server.name = discovery.get("serverName") or server.name
    server.transport = discovery.get("transport") or server.transport
    server.status = "connected"
    server.last_error = ""
    server.last_discovered_at = datetime.utcnow()
    discovered_names = set()
    imported = []
    for item in discovery.get("tools", []):
        remote_name = item["name"]
        discovered_names.add(remote_name)
        tool = (
            db.query(Tool)
            .filter(
                Tool.tenant_id == tenant_id,
                Tool.mcp_server_id == server.id,
                Tool.remote_name == remote_name,
            )
            .first()
        )
        if not tool:
            tool = Tool(
                id=str(uuid.uuid4()),
                tenant_id=tenant_id,
                slug=f"mcp__{server.bridge_server_id}__{remote_name}",
                name=item.get("title") or remote_name,
                description=item.get("description") or "",
                kind="mcp",
                input_schema_json="{}",
                requires_approval=bool(item.get("requiresApproval")),
                read_only=bool(item.get("readOnly")),
                destructive=bool(item.get("destructive")),
                idempotent=bool(item.get("idempotent")),
                mcp_server_id=server.id,
                remote_name=remote_name,
                enabled=True,
            )
            db.add(tool)
        else:
            tool.name = item.get("title") or remote_name
            tool.description = item.get("description") or ""
            tool.requires_approval = bool(item.get("requiresApproval"))
            tool.read_only = bool(item.get("readOnly"))
            tool.destructive = bool(item.get("destructive"))
            tool.idempotent = bool(item.get("idempotent"))
            tool.enabled = True
        tool.input_schema_json = json.dumps(
            item.get("inputSchema") or {}, ensure_ascii=False
        )
        imported.append(tool)

    stale = (
        db.query(Tool)
        .filter(
            Tool.tenant_id == tenant_id,
            Tool.mcp_server_id == server.id,
        )
        .all()
    )
    for tool in stale:
        if tool.remote_name not in discovered_names:
            tool.enabled = False
    db.commit()
    return imported


@app.get("/api/mcp/catalog")
def mcp_catalog(
    auth: AuthContext = Depends(require_roles("owner")),
) -> dict:
    try:
        return mcp_bridge.list_servers()
    except MCPBridgeError as exc:
        raise HTTPException(
            status_code=exc.status_code, detail=str(exc)
        ) from exc


@app.get("/api/mcp/servers")
def list_mcp_servers(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> List[dict]:
    servers = (
        db.query(MCPServer)
        .filter(MCPServer.tenant_id == auth.tenant.id)
        .order_by(MCPServer.updated_at.desc())
        .all()
    )
    return [serialize_mcp_server(db, server) for server in servers]


@app.post("/api/mcp/servers", status_code=201)
def register_mcp_server(
    payload: MCPImportRequest,
    auth: AuthContext = Depends(require_roles("owner")),
    db: Session = Depends(get_db),
) -> dict:
    try:
        discovery = mcp_bridge.discover(payload.bridge_server_id)
    except MCPBridgeError as exc:
        raise HTTPException(
            status_code=exc.status_code, detail=str(exc)
        ) from exc
    server = (
        db.query(MCPServer)
        .filter(
            MCPServer.tenant_id == auth.tenant.id,
            MCPServer.bridge_server_id == payload.bridge_server_id,
        )
        .first()
    )
    if not server:
        server = MCPServer(
            id=str(uuid.uuid4()),
            tenant_id=auth.tenant.id,
            bridge_server_id=payload.bridge_server_id,
            name=discovery.get("serverName") or payload.bridge_server_id,
            transport=discovery.get("transport") or "stdio",
            created_by=auth.user.id,
        )
        db.add(server)
        db.flush()
    tools = persist_mcp_discovery(
        db,
        auth.tenant.id,
        server,
        discovery,
        auth.user.id,
    )
    return {
        "server": serialize_mcp_server(db, server),
        "tools": [serialize_tool(tool) for tool in tools],
        "latencyMs": discovery.get("latencyMs", 0),
    }


@app.post("/api/mcp/servers/{server_id}/discover")
def discover_mcp_server(
    server_id: str,
    auth: AuthContext = Depends(require_roles("owner")),
    db: Session = Depends(get_db),
) -> dict:
    server = (
        db.query(MCPServer)
        .filter(
            MCPServer.id == server_id,
            MCPServer.tenant_id == auth.tenant.id,
        )
        .first()
    )
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server 不存在")
    try:
        discovery = mcp_bridge.discover(server.bridge_server_id)
    except MCPBridgeError as exc:
        server.status = "disconnected"
        server.last_error = str(exc)
        db.commit()
        raise HTTPException(
            status_code=exc.status_code, detail=str(exc)
        ) from exc
    tools = persist_mcp_discovery(
        db,
        auth.tenant.id,
        server,
        discovery,
        auth.user.id,
    )
    return {
        "server": serialize_mcp_server(db, server),
        "tools": [serialize_tool(tool) for tool in tools],
        "latencyMs": discovery.get("latencyMs", 0),
    }


@app.post("/api/mcp/servers/{server_id}/health")
def health_check_mcp_server(
    server_id: str,
    auth: AuthContext = Depends(require_roles("owner")),
    db: Session = Depends(get_db),
) -> dict:
    server = (
        db.query(MCPServer)
        .filter(
            MCPServer.id == server_id,
            MCPServer.tenant_id == auth.tenant.id,
        )
        .first()
    )
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server 不存在")
    try:
        result = mcp_bridge.health(server.bridge_server_id)
        server.status = "connected"
        server.last_error = ""
        db.commit()
        return result
    except MCPBridgeError as exc:
        server.status = "disconnected"
        server.last_error = str(exc)
        db.commit()
        raise HTTPException(
            status_code=exc.status_code, detail=str(exc)
        ) from exc


@app.post("/api/runs", status_code=202)
def create_run(
    payload: RunCreate,
    auth: AuthContext = Depends(
        require_roles("owner", "member", "approver")
    ),
    db: Session = Depends(get_db),
) -> dict:
    tenant, user = auth.tenant, auth.user
    agent = (
        db.query(Agent)
        .filter(Agent.id == payload.agent_id, Agent.tenant_id == tenant.id)
        .first()
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    if payload.version_id:
        version = (
            db.query(AgentVersion)
            .filter(
                AgentVersion.id == payload.version_id,
                AgentVersion.agent_id == agent.id,
                AgentVersion.status == "published",
            )
            .first()
        )
    else:
        version = sorted(
            [
                item
                for item in agent.versions
                if item.status == "published"
            ],
            key=lambda item: item.created_at,
            reverse=True,
        )[0] if any(
            item.status == "published" for item in agent.versions
        ) else None
    if not version:
        raise HTTPException(
            status_code=409, detail="Agent 没有已发布的运行版本"
        )
    run = runtime.create_run(
        db,
        tenant,
        agent,
        version,
        user.id,
        payload.input,
        fault_mode=payload.fault_mode,
    )
    return serialize_run(db, run, detail=True)


@app.get("/api/runs/{run_id}/stream")
def stream_run_events(
    run_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    resolved_tenant = auth.tenant
    run = (
        db.query(Run)
        .filter(Run.id == run_id, Run.tenant_id == resolved_tenant.id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="运行不存在")

    async def generate():
        last_signature = None
        idle_ticks = 0
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            stream_db = SessionLocal()
            try:
                current = (
                    stream_db.query(Run).filter(Run.id == run_id).first()
                )
                if not current:
                    return
                payload = serialize_run(stream_db, current, detail=True)
                events = payload.get("events", [])
                signature = (
                    payload["status"],
                    len(events),
                    events[-1]["id"] if events else "",
                    payload.get("attemptCount"),
                )
                if signature != last_signature:
                    last_signature = signature
                    idle_ticks = 0
                    data = json.dumps(
                        payload, ensure_ascii=False, default=str
                    )
                    yield f"event: snapshot\ndata: {data}\n\n"
                else:
                    idle_ticks += 1
                    if idle_ticks % 20 == 0:
                        yield ": keepalive\n\n"
                if payload["status"] in TERMINAL_STATUSES:
                    data = json.dumps(
                        payload, ensure_ascii=False, default=str
                    )
                    yield f"event: done\ndata: {data}\n\n"
                    return
            finally:
                stream_db.close()
            await asyncio.sleep(0.35)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/runs")
def list_runs(
    status: Optional[str] = Query(default=None),
    intent: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> List[dict]:
    tenant = auth.tenant
    query = db.query(Run).filter(Run.tenant_id == tenant.id)
    if status:
        query = query.filter(Run.status == status)
    if intent:
        query = query.filter(Run.intent == intent)
    if search:
        query = query.filter(
            Run.input.ilike(f"%{search}%")
            | Run.id.ilike(f"%{search}%")
        )
    runs = query.order_by(Run.started_at.desc()).limit(limit).all()
    return [serialize_run(db, run) for run in runs]


@app.get("/api/runs/{run_id}")
def get_run(
    run_id: str,
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> dict:
    tenant = auth.tenant
    run = (
        db.query(Run)
        .filter(Run.id == run_id, Run.tenant_id == tenant.id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="运行不存在")
    return serialize_run(db, run, detail=True)


@app.post("/api/runs/{run_id}/replay", status_code=201)
def replay_run(
    run_id: str,
    auth: AuthContext = Depends(require_roles("owner", "member")),
    db: Session = Depends(get_db),
) -> dict:
    tenant, user = auth.tenant, auth.user
    source = (
        db.query(Run)
        .filter(Run.id == run_id, Run.tenant_id == tenant.id)
        .first()
    )
    if not source:
        raise HTTPException(status_code=404, detail="运行不存在")
    agent = db.query(Agent).filter(Agent.id == source.agent_id).first()
    version = (
        db.query(AgentVersion)
        .filter(AgentVersion.id == source.agent_version_id)
        .first()
    )
    if not agent or not version:
        raise HTTPException(status_code=409, detail="运行版本不可用")
    replayed = runtime.create_run(
        db,
        tenant,
        agent,
        version,
        user.id,
        source.input,
        fault_mode=source.fault_mode,
        trigger="replay",
    )
    return serialize_run(db, replayed, detail=True)


@app.get("/api/approvals")
def list_approvals(
    status: Optional[str] = Query(default=None),
    auth: AuthContext = Depends(require_roles("owner", "approver")),
    db: Session = Depends(get_db),
) -> List[dict]:
    tenant = auth.tenant
    query = (
        db.query(Approval)
        .join(Run, Run.id == Approval.run_id)
        .filter(Run.tenant_id == tenant.id)
    )
    if status:
        query = query.filter(Approval.status == status)
    approvals = query.order_by(Approval.requested_at.desc()).all()
    output = []
    for approval in approvals:
        run = db.query(Run).filter(Run.id == approval.run_id).first()
        output.append(
            {
                "approval": serialize_approval(approval),
                "run": serialize_run(db, run) if run else None,
            }
        )
    return output


@app.post("/api/approvals/{approval_id}/decision")
def decide_approval(
    approval_id: str,
    payload: ApprovalDecision,
    auth: AuthContext = Depends(require_roles("owner", "approver")),
    db: Session = Depends(get_db),
) -> dict:
    tenant, user = auth.tenant, auth.user
    approval = (
        db.query(Approval)
        .join(Run, Run.id == Approval.run_id)
        .filter(Approval.id == approval_id, Run.tenant_id == tenant.id)
        .first()
    )
    if not approval:
        raise HTTPException(status_code=404, detail="审批不存在")
    try:
        run = runtime.decide_approval(
            db,
            approval,
            payload.approved,
            user.id,
            payload.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return serialize_run(db, run, detail=True)


@app.get("/api/evals/datasets")
def list_datasets(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> List[dict]:
    tenant = auth.tenant
    datasets = (
        db.query(EvalDataset)
        .filter(EvalDataset.tenant_id == tenant.id)
        .order_by(EvalDataset.created_at.desc())
        .all()
    )
    return [
        {
            "id": dataset.id,
            "name": dataset.name,
            "description": dataset.description,
            "caseCount": len(dataset.cases),
            "cases": [
                {
                    "id": case.id,
                    "name": case.name,
                    "input": case.input,
                    "expectedIntent": case.expected_intent,
                    "expectedOutcome": case.expected_outcome,
                }
                for case in dataset.cases
            ],
        }
        for dataset in datasets
    ]


@app.get("/api/evals/runs")
def list_eval_runs(
    auth: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> List[dict]:
    tenant = auth.tenant
    items = (
        db.query(EvalRun)
        .filter(EvalRun.tenant_id == tenant.id)
        .order_by(EvalRun.created_at.desc())
        .all()
    )
    return [
        {
            "id": item.id,
            "status": item.status,
            "agentId": item.agent_id,
            "agentVersionId": item.agent_version_id,
            "datasetName": (
                db.query(EvalDataset)
                .filter(EvalDataset.id == item.dataset_id)
                .first()
                .name
            ),
            "version": (
                db.query(AgentVersion)
                .filter(AgentVersion.id == item.agent_version_id)
                .first()
                .version
            ),
            "accuracy": item.accuracy,
            "successRate": item.success_rate,
            "p95LatencyMs": item.p95_latency_ms,
            "avgCostCents": item.avg_cost_cents,
            "passedCases": item.passed_cases,
            "totalCases": item.total_cases,
            "createdAt": item.created_at,
            "results": [
                {
                    "id": result.id,
                    "caseName": result.case_name,
                    "input": result.input,
                    "actualIntent": result.actual_intent,
                    "actualOutcome": result.actual_outcome,
                    "expectedIntent": result.expected_intent,
                    "expectedOutcome": result.expected_outcome,
                    "passed": result.passed,
                    "latencyMs": result.latency_ms,
                    "costCents": result.cost_cents,
                    "runId": result.run_id,
                }
                for result in item.results
            ],
        }
        for item in items
    ]


def execute_evaluation(
    db: Session,
    tenant,
    user,
    agent: Agent,
    version: AgentVersion,
    dataset: EvalDataset,
) -> dict:
    eval_run = EvalRun(
        id=str(uuid.uuid4()),
        tenant_id=tenant.id,
        dataset_id=dataset.id,
        agent_id=agent.id,
        agent_version_id=version.id,
        status="running",
    )
    db.add(eval_run)
    db.commit()
    passed = 0
    latencies = []
    costs = []
    for case in dataset.cases:
        run = runtime.create_run(
            db,
            tenant,
            agent,
            version,
            user.id,
            case.input,
            trigger="evaluation",
        )
        deadline = time.monotonic() + 60
        while run.status in ACTIVE_STATUSES and time.monotonic() < deadline:
            evaluation_worker.process_run(run.id)
            db.expire_all()
            run = db.query(Run).filter(Run.id == run.id).first()
            if run and run.status in ACTIVE_STATUSES:
                time.sleep(0.05)
        if not run or run.status in ACTIVE_STATUSES:
            raise HTTPException(status_code=504, detail="评测运行执行超时")
        if run.approval and run.approval.status == "pending":
            run.approval.status = "simulation"
            run.approval.note = "评测模式：验证审批拦截，未执行真实写操作。"
            run.approval.decided_at = datetime.utcnow()
            db.commit()
        is_pass = (
            run.intent == case.expected_intent
            and run.status == case.expected_outcome
        )
        passed += int(is_pass)
        latencies.append(run.latency_ms)
        costs.append(run.cost_cents)
        db.add(
            EvalResult(
                id=str(uuid.uuid4()),
                eval_run_id=eval_run.id,
                case_id=case.id,
                case_name=case.name,
                input=case.input,
                actual_intent=run.intent,
                actual_outcome=run.status,
                expected_intent=case.expected_intent,
                expected_outcome=case.expected_outcome,
                passed=is_pass,
                latency_ms=run.latency_ms,
                cost_cents=run.cost_cents,
                run_id=run.id,
            )
        )
        db.commit()

    sorted_latencies = sorted(latencies or [0])
    p95_index = min(
        len(sorted_latencies) - 1,
        max(0, int(round(len(sorted_latencies) * 0.95)) - 1),
    )
    total = len(dataset.cases)
    eval_run.status = "completed"
    eval_run.accuracy = round(passed / total, 4) if total else 0
    eval_run.success_rate = eval_run.accuracy
    eval_run.p95_latency_ms = sorted_latencies[p95_index]
    eval_run.avg_cost_cents = round(mean(costs), 3) if costs else 0
    eval_run.passed_cases = passed
    eval_run.total_cases = total
    eval_run.finished_at = datetime.utcnow()
    db.commit()
    return {
        "id": eval_run.id,
        "status": eval_run.status,
        "accuracy": eval_run.accuracy,
        "successRate": eval_run.success_rate,
        "p95LatencyMs": eval_run.p95_latency_ms,
        "avgCostCents": eval_run.avg_cost_cents,
        "passedCases": eval_run.passed_cases,
        "totalCases": eval_run.total_cases,
        "version": version.version,
    }


@app.post("/api/evals/runs", status_code=201)
def run_evaluation(
    payload: EvalRunCreate,
    auth: AuthContext = Depends(require_roles("owner", "member")),
    db: Session = Depends(get_db),
) -> dict:
    tenant, user = auth.tenant, auth.user
    agent = (
        db.query(Agent)
        .filter(Agent.id == payload.agent_id, Agent.tenant_id == tenant.id)
        .first()
    )
    dataset = (
        db.query(EvalDataset)
        .filter(
            EvalDataset.id == payload.dataset_id,
            EvalDataset.tenant_id == tenant.id,
        )
        .first()
    )
    if not agent or not dataset:
        raise HTTPException(status_code=404, detail="Agent 或评测集不存在")
    if payload.version_id:
        version = (
            db.query(AgentVersion)
            .filter(
                AgentVersion.id == payload.version_id,
                AgentVersion.agent_id == agent.id,
            )
            .first()
        )
    else:
        version = sorted(
            agent.versions, key=lambda item: item.created_at, reverse=True
        )[0]
    if not version:
        raise HTTPException(status_code=409, detail="Agent 没有可运行版本")
    return execute_evaluation(db, tenant, user, agent, version, dataset)


@app.post("/api/agents/{agent_id}/versions/{version_id}/release-check")
def release_check(
    agent_id: str,
    version_id: str,
    payload: ReleaseCheckRequest,
    auth: AuthContext = Depends(require_roles("owner", "member")),
    db: Session = Depends(get_db),
) -> dict:
    tenant, user = auth.tenant, auth.user
    agent = (
        db.query(Agent)
        .filter(Agent.id == agent_id, Agent.tenant_id == tenant.id)
        .first()
    )
    version = (
        db.query(AgentVersion)
        .filter(
            AgentVersion.id == version_id,
            AgentVersion.agent_id == agent_id,
        )
        .first()
    )
    dataset = (
        db.query(EvalDataset)
        .filter(
            EvalDataset.id == payload.dataset_id,
            EvalDataset.tenant_id == tenant.id,
        )
        .first()
    )
    if not agent or not version or not dataset:
        raise HTTPException(
            status_code=404, detail="Agent、版本或评测集不存在"
        )
    if version.status == "published":
        raise HTTPException(status_code=409, detail="该版本已经发布")
    if version.status != "draft":
        raise HTTPException(
            status_code=409, detail="只有 Draft 版本可以执行发布门禁"
        )

    summary = execute_evaluation(
        db, tenant, user, agent, version, dataset
    )
    failures = []
    if summary["accuracy"] < payload.min_accuracy:
        failures.append(
            f"准确率 {summary['accuracy']:.0%} "
            f"低于 {payload.min_accuracy:.0%}"
        )
    if summary["p95LatencyMs"] > payload.max_p95_latency_ms:
        failures.append(
            f"P95 延迟 {summary['p95LatencyMs']}ms "
            f"高于 {payload.max_p95_latency_ms}ms"
        )
    if summary["avgCostCents"] > payload.max_avg_cost_cents:
        failures.append(
            f"平均成本 {summary['avgCostCents']:.3f} 美分 "
            f"高于 {payload.max_avg_cost_cents:.3f} 美分"
        )
    passed = not failures
    reason = "全部发布门槛通过" if passed else "；".join(failures)
    check = ReleaseCheck(
        id=str(uuid.uuid4()),
        tenant_id=tenant.id,
        agent_id=agent.id,
        agent_version_id=version.id,
        eval_run_id=summary["id"],
        created_by=user.id,
        passed=passed,
        min_accuracy=payload.min_accuracy,
        max_p95_latency_ms=payload.max_p95_latency_ms,
        max_avg_cost_cents=payload.max_avg_cost_cents,
        actual_accuracy=summary["accuracy"],
        actual_p95_latency_ms=summary["p95LatencyMs"],
        actual_avg_cost_cents=summary["avgCostCents"],
        reason=reason,
    )
    db.add(check)
    if passed:
        db.query(AgentVersion).filter(
            AgentVersion.agent_id == agent.id,
            AgentVersion.status == "published",
        ).update(
            {AgentVersion.status: "superseded"},
            synchronize_session=False,
        )
        version.status = "published"
        agent.status = "active"
        agent.updated_at = datetime.utcnow()
    db.commit()
    return {
        **summary,
        "checkId": check.id,
        "passed": passed,
        "reason": reason,
        "thresholds": {
            "minAccuracy": payload.min_accuracy,
            "maxP95LatencyMs": payload.max_p95_latency_ms,
            "maxAvgCostCents": payload.max_avg_cost_cents,
        },
    }
