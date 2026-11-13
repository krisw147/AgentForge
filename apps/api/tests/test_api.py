from __future__ import annotations

from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import (
    AgentTool,
    AgentVersion,
    AuthSession,
    MCPServer,
    Run,
    Tool,
)
from app.seed import (
    PRIMARY_AGENT_ID,
    PRIMARY_TENANT_ID,
    PRIMARY_VERSION_ID,
)
from app.services.tools import execute_tool
from app.services.runtime import redact_sensitive_data
from app.services.mcp_bridge import mcp_bridge
from app.worker import RuntimeWorker


DEMO_PASSWORD = "demo1234"
OWNER_EMAIL = "lin@forward.tech"
MEMBER_EMAIL = "zhou@forward.tech"
APPROVER_EMAIL = "chen@forward.tech"


def login(client: TestClient, email: str = OWNER_EMAIL) -> dict:
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": DEMO_PASSWORD},
    )
    assert response.status_code == 200
    return response.json()


def create_and_process_run(
    client: TestClient,
    prompt: str,
    worker_name: str,
    fault_mode: str = "",
) -> dict:
    created = client.post(
        "/api/runs",
        json={
            "agent_id": PRIMARY_AGENT_ID,
            "version_id": PRIMARY_VERSION_ID,
            "input": prompt,
            "fault_mode": fault_mode,
        },
    )
    assert created.status_code == 202
    run_id = created.json()["id"]
    worker = RuntimeWorker(worker_id=worker_name, lease_seconds=5)
    assert worker.process_run(run_id)
    return client.get(f"/api/runs/{run_id}").json()


def test_auth_required_and_session_cookie() -> None:
    with TestClient(app) as client:
        unauthorized = client.get("/api/dashboard")
        assert unauthorized.status_code == 401
        assert client.get("/health").status_code == 200

        invalid = client.post(
            "/api/auth/login",
            json={"email": OWNER_EMAIL, "password": "wrong-password"},
        )
        assert invalid.status_code == 401
        assert "password_hash" not in invalid.text

        response = client.post(
            "/api/auth/login",
            json={"email": OWNER_EMAIL, "password": DEMO_PASSWORD},
        )
        assert response.status_code == 200
        assert "httponly" in response.headers["set-cookie"].lower()
        assert "samesite=lax" in response.headers["set-cookie"].lower()
        auth = response.json()
        assert auth["user"]["email"] == OWNER_EMAIL
        assert auth["activeTenant"]["role"] == "owner"
        assert "password_hash" not in response.text

        dashboard = client.get(
            "/api/dashboard",
            headers={"X-Tenant-Slug": "greenleaf"},
        )
        assert dashboard.status_code == 200
        assert dashboard.json()["tenant"]["slug"] == "forward-tech"


def test_workspace_membership_and_tenant_isolation() -> None:
    with TestClient(app) as client:
        login(client)
        primary_runs = client.get("/api/runs").json()
        assert len(primary_runs) > 0

        switched = client.post(
            "/api/auth/switch-workspace",
            json={"slug": "greenleaf"},
        )
        assert switched.status_code == 200
        assert switched.json()["activeTenant"]["slug"] == "greenleaf"

        hidden = client.get(f"/api/runs/{primary_runs[0]['id']}")
        assert hidden.status_code == 404

        forbidden = client.post(
            "/api/auth/switch-workspace",
            json={"slug": "not-a-membership"},
        )
        assert forbidden.status_code == 403


def test_member_cannot_approve_and_approver_can() -> None:
    with TestClient(app) as client:
        login(client)
        waiting = create_and_process_run(
            client,
            "订单 ORD-2026-0991 是定制商品，有质量问题，我想退款。",
            "test-role-worker",
        )
        assert waiting["status"] == "waiting_approval"
        approval_id = waiting["approval"]["id"]

        login(client, MEMBER_EMAIL)
        denied_list = client.get("/api/approvals?status=pending")
        assert denied_list.status_code == 403
        denied_decision = client.post(
            f"/api/approvals/{approval_id}/decision",
            json={"approved": True, "note": "member should not approve"},
        )
        assert denied_decision.status_code == 403

        approver_auth = login(client, APPROVER_EMAIL)
        assert approver_auth["activeTenant"]["role"] == "approver"
        approved = client.post(
            f"/api/approvals/{approval_id}/decision",
            json={"approved": True, "note": "approver verified"},
        )
        assert approved.status_code == 200
        assert approved.json()["status"] == "queued"

        worker = RuntimeWorker(
            worker_id="approval-resume-worker", lease_seconds=5
        )
        assert worker.process_run(waiting["id"])
        completed = client.get(f"/api/runs/{waiting['id']}").json()
        assert completed["status"] == "completed"


def test_refund_run_waits_for_approval_and_resumes() -> None:
    with TestClient(app) as client:
        login(client)
        waiting = create_and_process_run(
            client,
            "订单 ORD-2026-1042 的耳机不合适，我要申请退款。",
            "test-refund-worker",
            fault_mode="tool_timeout",
        )
        assert waiting["status"] == "waiting_approval"
        assert any(
            event["type"] == "tool.completed"
            and event["payload"]["attempts"] == 2
            for event in waiting["events"]
        )
        assert waiting["inputTokens"] > 0

        decided = client.post(
            f"/api/approvals/{waiting['approval']['id']}/decision",
            json={"approved": True, "note": "金额与订单已核验"},
        )
        assert decided.status_code == 200
        assert decided.json()["status"] == "queued"

        worker = RuntimeWorker(
            worker_id="approval-compliance", lease_seconds=5
        )
        assert worker.process_run(waiting["id"])
        resumed = client.get(f"/api/runs/{waiting['id']}").json()
        assert resumed["status"] == "completed"
        assert resumed["approval"]["status"] == "approved"
        assert any(
            event["type"] == "tool.completed"
            and event["payload"]["tool"] == "issue_refund"
            for event in resumed["events"]
        )
        assert "退款已受理" in resumed["output"]


def test_rejected_approval_does_not_execute_refund() -> None:
    with TestClient(app) as client:
        login(client)
        waiting = create_and_process_run(
            client,
            "订单 ORD-2026-0991 是定制商品，有质量问题，我想退款。",
            "test-reject-worker",
        )
        rejected = client.post(
            f"/api/approvals/{waiting['approval']['id']}/decision",
            json={"approved": False, "note": "缺少质量问题凭证"},
        )
        assert rejected.status_code == 200
        body = rejected.json()
        assert body["status"] == "rejected"
        assert not any(
            event["type"] == "tool.completed"
            and event["payload"].get("tool") == "issue_refund"
            for event in body["events"]
        )


def test_policy_question_and_evaluation_regression() -> None:
    with TestClient(app) as client:
        login(client)
        policy = create_and_process_run(
            client,
            "超过 7 天的商品还能无理由退款吗？",
            "test-policy-worker",
        )
        assert policy["intent"] == "policy_question"
        assert policy["status"] == "completed"

        datasets = client.get("/api/evals/datasets").json()
        pending_before = client.get("/api/approvals?status=pending").json()
        evaluation = client.post(
            "/api/evals/runs",
            json={
                "agent_id": PRIMARY_AGENT_ID,
                "dataset_id": datasets[0]["id"],
                "version_id": PRIMARY_VERSION_ID,
            },
        )
        assert evaluation.status_code == 201
        result = evaluation.json()
        assert result["status"] == "completed"
        assert result["totalCases"] == 8
        assert result["accuracy"] == 1.0
        pending_after = client.get("/api/approvals?status=pending").json()
        assert len(pending_after) == len(pending_before)


def test_release_gate_promotes_only_passing_draft() -> None:
    with TestClient(app) as client:
        login(client)
        dataset_id = client.get("/api/evals/datasets").json()[0]["id"]
        version = client.post(
            f"/api/agents/{PRIMARY_AGENT_ID}/versions",
            json={
                "model": "demo-deterministic",
                "system_prompt": "发布门禁测试版本",
                "max_steps": 8,
                "budget_cents": 20,
                "config": {"temperature": 0.1, "trace": True},
            },
        )
        assert version.status_code == 201
        version_id = version.json()["id"]
        assert version.json()["status"] == "draft"

        passed = client.post(
            f"/api/agents/{PRIMARY_AGENT_ID}/versions/{version_id}/release-check",
            json={
                "dataset_id": dataset_id,
                "min_accuracy": 0.9,
                "max_p95_latency_ms": 10000,
                "max_avg_cost_cents": 10,
            },
        )
        assert passed.status_code == 200
        assert passed.json()["passed"] is True

        published_agent = client.get(
            f"/api/agents/{PRIMARY_AGENT_ID}"
        ).json()
        assert published_agent["latestVersion"]["id"] == version_id
        assert any(
            check["agentVersionId"] == version_id and check["passed"]
            for check in published_agent["releaseChecks"]
        )

        blocked_version = client.post(
            f"/api/agents/{PRIMARY_AGENT_ID}/versions",
            json={
                "model": "demo-deterministic",
                "system_prompt": "应当被延迟门禁阻止",
                "max_steps": 8,
                "budget_cents": 20,
                "config": {"temperature": 0.1, "trace": True},
            },
        ).json()
        blocked = client.post(
            (
                f"/api/agents/{PRIMARY_AGENT_ID}/versions/"
                f"{blocked_version['id']}/release-check"
            ),
            json={
                "dataset_id": dataset_id,
                "min_accuracy": 1,
                "max_p95_latency_ms": 1,
                "max_avg_cost_cents": 10,
            },
        )
        assert blocked.status_code == 200
        assert blocked.json()["passed"] is False
        agent_after_block = client.get(
            f"/api/agents/{PRIMARY_AGENT_ID}"
        ).json()
        assert agent_after_block["latestVersion"]["id"] == version_id
        assert agent_after_block["latestDraft"]["id"] == blocked_version["id"]


def test_approver_cannot_promote_draft_version() -> None:
    with TestClient(app) as client:
        login(client)
        version = client.post(
            f"/api/agents/{PRIMARY_AGENT_ID}/versions",
            json={
                "model": "demo-deterministic",
                "system_prompt": "approver cannot publish",
                "max_steps": 8,
                "budget_cents": 20,
                "config": {},
            },
        ).json()
        login(client, APPROVER_EMAIL)
        response = client.post(
            (
                f"/api/agents/{PRIMARY_AGENT_ID}/versions/"
                f"{version['id']}/release-check"
            ),
            json={
                "dataset_id": "dataset-refund-regression",
                "min_accuracy": 0,
                "max_p95_latency_ms": 10000,
                "max_avg_cost_cents": 10,
            },
        )
        assert response.status_code == 403


def test_draft_binds_mcp_tools_and_worker_executes_them(monkeypatch) -> None:
    mcp_calls = []

    def fake_call(server_id, tool_name, arguments):
        mcp_calls.append((server_id, tool_name, arguments))
        if tool_name == "get_order":
            data = {
                "id": arguments["order_id"],
                "customer": "MCP 用户",
                "product": "MCP 测试商品",
                "amount": 668,
                "status": "MCP 已签收",
                "category": "electronics",
                "refundable": True,
            }
        elif tool_name == "issue_refund":
            data = {
                "refund_id": "RF-MCP-TEST",
                "order_id": arguments["order_id"],
                "amount": arguments["amount"],
                "status": "processing",
            }
        else:
            data = {
                "ticket_id": "TK-MCP-TEST",
                "subject": arguments["subject"],
                "priority": arguments.get("priority", "normal"),
                "assignee": "售后支持组",
            }
        return {
            "ok": True,
            "isError": False,
            "latencyMs": 5,
            "content": [{"type": "text", "text": "ok"}],
            "structuredContent": data,
        }

    monkeypatch.setattr(mcp_bridge, "call", fake_call)

    db = SessionLocal()
    try:
        mcp_server = MCPServer(
            id="mcp-server-binding-test",
            tenant_id=PRIMARY_TENANT_ID,
            bridge_server_id="order-server-binding-test",
            name="绑定测试 MCP",
            transport="stdio",
            created_by="user-lin",
        )
        get_order_tool = Tool(
            id="mcp-tool-get-order-test",
            tenant_id=PRIMARY_TENANT_ID,
            slug="mcp__order-server__get_order",
            name="MCP 查询订单",
            description="MCP get order",
            kind="mcp",
            input_schema_json="{}",
            requires_approval=False,
            read_only=True,
            mcp_server_id=mcp_server.id,
            remote_name="get_order",
        )
        refund_tool = Tool(
            id="mcp-tool-refund-test",
            tenant_id=PRIMARY_TENANT_ID,
            slug="mcp__order-server__issue_refund",
            name="MCP 发起退款",
            description="MCP refund",
            kind="mcp",
            input_schema_json="{}",
            requires_approval=True,
            destructive=True,
            idempotent=True,
            mcp_server_id=mcp_server.id,
            remote_name="issue_refund",
        )
        ticket_tool = Tool(
            id="mcp-tool-ticket-test",
            tenant_id=PRIMARY_TENANT_ID,
            slug="mcp__order-server__create_ticket",
            name="MCP 创建工单",
            description="MCP ticket",
            kind="mcp",
            input_schema_json="{}",
            requires_approval=True,
            destructive=False,
            idempotent=False,
            mcp_server_id=mcp_server.id,
            remote_name="create_ticket",
        )
        db.add_all([mcp_server, get_order_tool, refund_tool, ticket_tool])
        db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        login(client)
        draft = client.post(
            f"/api/agents/{PRIMARY_AGENT_ID}/versions",
            json={
                "model": "demo-deterministic",
                "system_prompt": "MCP 绑定测试",
                "max_steps": 8,
                "budget_cents": 20,
                "config": {"temperature": 0.1, "trace": True},
            },
        ).json()

        db = SessionLocal()
        try:
            builtin_ids = [
                tool.id
                for tool in db.query(Tool)
                .filter(
                    Tool.tenant_id == PRIMARY_TENANT_ID,
                    Tool.mcp_server_id.is_(None),
                    Tool.enabled.is_(True),
                )
                .all()
            ]
        finally:
            db.close()
        assigned = builtin_ids + [
            "mcp-tool-get-order-test",
            "mcp-tool-refund-test",
            "mcp-tool-ticket-test",
        ]
        bound = client.put(
            f"/api/agents/{PRIMARY_AGENT_ID}/versions/{draft['id']}/tools",
            json={"tool_ids": assigned},
        )
        assert bound.status_code == 200
        assert any(
            tool["source"] == "mcp" for tool in bound.json()["tools"]
        )

        dataset_id = client.get("/api/evals/datasets").json()[0]["id"]
        released = client.post(
            (
                f"/api/agents/{PRIMARY_AGENT_ID}/versions/"
                f"{draft['id']}/release-check"
            ),
            json={
                "dataset_id": dataset_id,
                "min_accuracy": 0.8,
                "max_p95_latency_ms": 10000,
                "max_avg_cost_cents": 10,
            },
        )
        assert released.status_code == 200
        assert released.json()["passed"] is True
        assert any(call[1] == "get_order" for call in mcp_calls)

        order_run = client.post(
            "/api/runs",
            json={
                "agent_id": PRIMARY_AGENT_ID,
                "version_id": draft["id"],
                "input": "查询订单 ORD-2026-1042 的状态",
            },
        ).json()
        worker = RuntimeWorker(
            worker_id="mcp-order-worker", lease_seconds=5
        )
        assert worker.process_run(order_run["id"])
        completed = client.get(f"/api/runs/{order_run['id']}").json()
        tool_event = next(
            event
            for event in completed["events"]
            if event["type"] == "tool.completed"
            and event["payload"].get("tool") == "get_order"
        )
        assert tool_event["payload"]["source"] == "mcp"
        assert "MCP 已签收" in completed["output"]

        refund_run = client.post(
            "/api/runs",
            json={
                "agent_id": PRIMARY_AGENT_ID,
                "version_id": draft["id"],
                "input": "订单 ORD-2026-1042 申请退款",
            },
        ).json()
        worker = RuntimeWorker(
            worker_id="mcp-refund-worker", lease_seconds=5
        )
        assert worker.process_run(refund_run["id"])
        waiting = client.get(f"/api/runs/{refund_run['id']}").json()
        assert waiting["status"] == "waiting_approval"
        approved = client.post(
            f"/api/approvals/{waiting['approval']['id']}/decision",
            json={"approved": True, "note": "MCP 退款审批"},
        )
        assert approved.status_code == 200
        assert worker.process_run(refund_run["id"])
        refund_done = client.get(f"/api/runs/{refund_run['id']}").json()
        refund_event = next(
            event
            for event in refund_done["events"]
            if event["type"] == "tool.completed"
            and event["payload"].get("tool") == "issue_refund"
        )
        assert refund_event["payload"]["source"] == "mcp"
        assert "RF-MCP-TEST" in refund_done["output"]

        ticket_run = client.post(
            "/api/runs",
            json={
                "agent_id": PRIMARY_AGENT_ID,
                "version_id": draft["id"],
                "input": "包装破损，请创建优先工单",
            },
        ).json()
        worker = RuntimeWorker(
            worker_id="mcp-ticket-worker", lease_seconds=5
        )
        assert worker.process_run(ticket_run["id"])
        ticket_waiting = client.get(
            f"/api/runs/{ticket_run['id']}"
        ).json()
        assert ticket_waiting["status"] == "waiting_approval"
        ticket_approved = client.post(
            (
                f"/api/approvals/"
                f"{ticket_waiting['approval']['id']}/decision"
            ),
            json={"approved": True, "note": "允许创建工单"},
        )
        assert ticket_approved.status_code == 200
        assert worker.process_run(ticket_run["id"])
        ticket_done = client.get(f"/api/runs/{ticket_run['id']}").json()
        ticket_event = next(
            event
            for event in ticket_done["events"]
            if event["type"] == "tool.completed"
            and event["payload"].get("tool") == "create_ticket"
        )
        assert ticket_event["payload"]["source"] == "mcp"
        assert "TK-MCP-TEST" in ticket_done["output"]

        db = SessionLocal()
        try:
            db.add(
                Tool(
                    id="disabled-clone-tool",
                    tenant_id=PRIMARY_TENANT_ID,
                    slug="mcp__order-server__disabled",
                    name="Disabled MCP Tool",
                    description="must not be cloned",
                    kind="mcp",
                    input_schema_json="{}",
                    mcp_server_id=mcp_server.id,
                    remote_name="disabled",
                    enabled=False,
                )
            )
            db.add(
                AgentTool(
                    agent_version_id=draft["id"],
                    tool_id="disabled-clone-tool",
                )
            )
            db.commit()
        finally:
            db.close()
        cloned = client.post(
            f"/api/agents/{PRIMARY_AGENT_ID}/versions",
            json={
                "model": "demo-deterministic",
                "system_prompt": "clone filter",
                "max_steps": 8,
                "budget_cents": 20,
                "config": {},
            },
        ).json()
        agent_detail = client.get(
            f"/api/agents/{PRIMARY_AGENT_ID}"
        ).json()
        assert (
            "disabled-clone-tool"
            not in agent_detail["toolBindings"][cloned["id"]]
        )


def test_expired_worker_lease_is_recovered() -> None:
    with TestClient(app) as client:
        login(client)
        db = SessionLocal()
        try:
            recovery_version = AgentVersion(
                id="recovery-test-version",
                agent_id=PRIMARY_AGENT_ID,
                version="recovery-test",
                model="demo-deterministic",
                system_prompt="lease recovery test",
                max_steps=4,
                budget_cents=10,
                config_json="{}",
                status="published",
            )
            db.add(recovery_version)
            db.commit()
        finally:
            db.close()
        created = client.post(
            "/api/runs",
            json={
                "agent_id": PRIMARY_AGENT_ID,
                "version_id": "recovery-test-version",
                "input": "超过 7 天的商品还能无理由退款吗？",
            },
        )
        assert created.status_code == 202
        run_id = created.json()["id"]

        db = SessionLocal()
        try:
            run = db.query(Run).filter(Run.id == run_id).first()
            run.status = "running"
            run.worker_id = "lost-worker"
            run.attempt_count = 1
            run.lease_expires_at = datetime.utcnow() - timedelta(seconds=1)
            run.heartbeat_at = datetime.utcnow() - timedelta(seconds=20)
            db.commit()
        finally:
            db.close()

        recovery_worker = RuntimeWorker(
            worker_id="recovery-worker", lease_seconds=5
        )
        assert recovery_worker.run_once()
        recovered = client.get(f"/api/runs/{run_id}").json()
        assert recovered["status"] == "completed"
        assert recovered["workerId"] == "recovery-worker"
        assert recovered["attemptCount"] >= 2
        assert any(
            event["type"] == "job.recovered"
            for event in recovered["events"]
        )


def test_event_stream_and_csrf_origin_protection() -> None:
    with TestClient(app) as client:
        login(client)
        response = client.get("/api/runs/seed-run-01/stream")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith(
            "text/event-stream"
        )
        assert "event: snapshot" in response.text
        assert "event: done" in response.text

        blocked = client.post(
            "/api/auth/logout",
            headers={"Origin": "https://evil.example"},
        )
        assert blocked.status_code == 403

        logout = client.post("/api/auth/logout")
        assert logout.status_code == 200
        assert client.get("/api/auth/me").status_code == 401


def test_owner_imports_and_refreshes_mcp_tools(monkeypatch) -> None:
    discovery = {
        "serverId": "order-server",
        "serverName": "本地订单 MCP",
        "transport": "stdio",
        "latencyMs": 12,
        "tools": [
            {
                "name": "get_order",
                "title": "查询订单",
                "description": "查询订单状态",
                "inputSchema": {
                    "type": "object",
                    "properties": {"order_id": {"type": "string"}},
                },
                "readOnly": True,
                "destructive": False,
                "idempotent": False,
                "requiresApproval": False,
            },
            {
                "name": "issue_refund",
                "title": "发起退款",
                "description": "敏感资金操作",
                "inputSchema": {
                    "type": "object",
                    "properties": {"order_id": {"type": "string"}},
                },
                "readOnly": False,
                "destructive": True,
                "idempotent": True,
                "requiresApproval": True,
            },
        ],
    }
    monkeypatch.setattr(mcp_bridge, "discover", lambda _server_id: discovery)
    monkeypatch.setattr(
        mcp_bridge,
        "health",
        lambda _server_id: {
            "serverId": "order-server",
            "status": "healthy",
            "latencyMs": 8,
        },
    )
    monkeypatch.setattr(
        mcp_bridge,
        "list_servers",
        lambda: {
            "servers": [
                {
                    "id": "order-server",
                    "name": "本地订单 MCP",
                    "transport": "stdio",
                    "allowedTools": ["get_order", "issue_refund"],
                    "requiresApproval": ["issue_refund"],
                }
            ]
        },
    )

    with TestClient(app) as client:
        login(client)
        catalog = client.get("/api/mcp/catalog")
        assert catalog.status_code == 200
        assert catalog.json()["servers"][0]["id"] == "order-server"

        imported = client.post(
            "/api/mcp/servers",
            json={"bridge_server_id": "order-server"},
        )
        assert imported.status_code == 201
        body = imported.json()
        assert body["server"]["toolCount"] == 2
        assert body["server"]["transport"] == "stdio"
        assert {tool["remoteName"] for tool in body["tools"]} == {
            "get_order",
            "issue_refund",
        }
        refund_tool = next(
            tool
            for tool in body["tools"]
            if tool["remoteName"] == "issue_refund"
        )
        assert refund_tool["requiresApproval"] is True
        assert refund_tool["destructive"] is True

        db = SessionLocal()
        try:
            server = (
                db.query(MCPServer)
                .filter(MCPServer.bridge_server_id == "order-server")
                .first()
            )
            assert server is not None
            assert (
                db.query(Tool)
                .filter(
                    Tool.mcp_server_id == server.id,
                    Tool.kind == "mcp",
                )
                .count()
                == 2
            )
            server_id = server.id
        finally:
            db.close()

        refreshed = client.post(
            f"/api/mcp/servers/{server_id}/discover"
        )
        assert refreshed.status_code == 200
        assert refreshed.json()["server"]["toolCount"] == 2
        checked = client.post(f"/api/mcp/servers/{server_id}/health")
        assert checked.status_code == 200
        assert checked.json()["status"] == "healthy"

        login(client, MEMBER_EMAIL)
        assert client.get("/api/mcp/servers").status_code == 200
        denied = client.post(
            "/api/mcp/servers",
            json={"bridge_server_id": "order-server"},
        )
        assert denied.status_code == 403


def test_expired_session_is_rejected() -> None:
    with TestClient(app) as client:
        login(client)
        db = SessionLocal()
        try:
            session = (
                db.query(AuthSession)
                .order_by(AuthSession.created_at.desc())
                .first()
            )
            session.expires_at = datetime.utcnow() - timedelta(seconds=1)
            db.commit()
        finally:
            db.close()
        assert client.get("/api/auth/me").status_code == 401


def test_tool_idempotency_reuses_sensitive_result() -> None:
    key = "test-refund-idempotency"
    first = execute_tool(
        "issue_refund",
        {
            "order_id": "ORD-2026-1042",
            "amount": 668,
            "reason": "幂等测试",
        },
        idempotency_key=key,
    )
    second = execute_tool(
        "issue_refund",
        {
            "order_id": "ORD-2026-1042",
            "amount": 668,
            "reason": "幂等测试",
        },
        idempotency_key=key,
    )
    assert first.ok and second.ok
    assert first.data["refund_id"] == second.data["refund_id"]
    assert second.reused is True


def test_mcp_output_redaction_removes_secrets() -> None:
    payload = {
        "order_id": "ORD-2026-1042",
        "access_token": "secret-token",
        "nested": {
            "api_key": "secret-key",
            "safe": "visible",
        },
        "items": [{"Authorization": "Bearer hidden", "value": 1}],
    }
    redacted = redact_sensitive_data(payload)
    assert redacted["order_id"] == "ORD-2026-1042"
    assert redacted["access_token"] == "[REDACTED]"
    assert redacted["nested"]["api_key"] == "[REDACTED]"
    assert redacted["nested"]["safe"] == "visible"
    assert redacted["items"][0]["Authorization"] == "[REDACTED]"
