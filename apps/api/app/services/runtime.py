from __future__ import annotations

import json
import re
import time
import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models import (
    Agent,
    AgentTool,
    AgentVersion,
    Approval,
    MCPServer,
    Run,
    RunEvent,
    Tenant,
    Tool,
)
from .mcp_bridge import MCPBridgeError, mcp_bridge
from .model_gateway import ModelGateway
from .retrieval import RetrievedDocument, retrieve_documents
from .tools import ToolResult, execute_tool


def parse_event_payload(event: RunEvent) -> dict:
    try:
        return json.loads(event.payload_json)
    except (TypeError, json.JSONDecodeError):
        return {}


def redact_sensitive_data(value):
    sensitive_markers = (
        "token",
        "secret",
        "password",
        "authorization",
        "cookie",
        "api_key",
        "apikey",
    )
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if any(marker in str(key).lower() for marker in sensitive_markers):
                result[key] = "[REDACTED]"
            else:
                result[key] = redact_sensitive_data(item)
        return result
    if isinstance(value, list):
        return [redact_sensitive_data(item) for item in value]
    return value


class AgentRuntime:
    def __init__(self) -> None:
        self.model = ModelGateway()

    @staticmethod
    def detect_intent(prompt: str, version_name: str = "") -> str:
        refund_requested = any(
            word in prompt for word in ("退款", "退货", "退钱", "退一下")
        )
        policy_requested = any(
            word in prompt
            for word in ("政策", "规则", "多久", "到账", "无理由", "7 天", "七天")
        )
        # The 1.0 seed version intentionally preserves a real classification
        # regression so the evaluation console demonstrates version comparison.
        if version_name == "1.0.0" and refund_requested:
            return "refund"
        if policy_requested:
            return "policy_question"
        if refund_requested:
            return "refund"
        if any(word in prompt for word in ("工单", "破损", "投诉", "没发货")):
            return "ticket"
        if any(word in prompt for word in ("订单", "物流", "OR-")):
            return "order_lookup"
        return "unknown"

    @staticmethod
    def extract_order_id(prompt: str) -> str:
        match = re.search(r"ORD-[A-Za-z0-9-]+", prompt.upper())
        return match.group(0) if match else ""

    @staticmethod
    def _next_seq(run: Run) -> int:
        return max((event.seq for event in run.events), default=0) + 1

    def add_event(
        self,
        db: Session,
        run: Run,
        kind: str,
        title: str,
        payload: Optional[dict] = None,
        latency_ms: int = 0,
        created_at: Optional[datetime] = None,
    ) -> RunEvent:
        event = RunEvent(
            id=str(uuid.uuid4()),
            run_id=run.id,
            seq=self._next_seq(run),
            type=kind,
            title=title,
            payload_json=json.dumps(payload or {}, ensure_ascii=False),
            latency_ms=latency_ms,
            created_at=created_at or datetime.utcnow(),
        )
        db.add(event)
        run.events.append(event)
        db.commit()
        db.refresh(run)
        return event

    def create_run(
        self,
        db: Session,
        tenant: Tenant,
        agent: Agent,
        version: AgentVersion,
        user_id: str,
        prompt: str,
        fault_mode: str = "",
        trigger: str = "playground",
    ) -> Run:
        run = Run(
            id=str(uuid.uuid4()),
            tenant_id=tenant.id,
            agent_id=agent.id,
            agent_version_id=version.id,
            user_id=user_id,
            status="queued",
            input=prompt,
            trigger=trigger,
            fault_mode=fault_mode,
            started_at=datetime.utcnow(),
        )
        db.add(run)
        db.flush()
        self.add_event(
            db,
            run,
            "run.queued",
            "运行已进入队列",
            {
                "agent_version": version.version,
                "trigger": trigger,
                "fault_mode": fault_mode or None,
            },
            latency_ms=0,
        )
        db.commit()
        db.refresh(run)
        return run

    def execute(self, db: Session, run: Run) -> Run:
        started = time.perf_counter()
        version = run.version
        self.add_event(
            db,
            run,
            "run.started",
            "Worker 开始执行",
            {
                "model": self.model.provider,
                "max_steps": version.max_steps,
                "budget_cents": version.budget_cents,
                "fault_mode": run.fault_mode or None,
            },
            latency_ms=24,
        )
        intent = self.detect_intent(run.input, version.version)
        run.intent = intent
        self.add_event(
            db,
            run,
            "intent.detected",
            f"识别意图 · {intent}",
            {"intent": intent, "confidence": 0.94 if intent != "unknown" else 0.43},
            latency_ms=91,
        )
        if intent == "unknown":
            self._finish_run(
                db,
                run,
                status="needs_input",
                output="我还需要更多信息。请补充订单号，或说明是要查询订单、申请退款还是创建工单。",
                started=started,
                facts={"intent": intent},
            )
            return run

        docs = retrieve_documents(db, run.tenant_id, run.input)
        self.add_event(
            db,
            run,
            "retrieval.completed",
            f"检索企业知识库 · {len(docs)} 条结果",
            {
                "documents": [
                    {
                        "title": doc.title,
                        "source": doc.source,
                        "score": doc.score,
                        "excerpt": doc.content[:120],
                    }
                    for doc in docs
                ]
            },
            latency_ms=118,
        )

        if intent == "policy_question":
            answer = self._policy_answer(docs)
            self._finish_run(
                db,
                run,
                status="completed",
                output=answer,
                started=started,
                facts={"intent": intent, "documents": [doc.title for doc in docs]},
            )
            return run

        if intent == "ticket":
            priority = (
                "high"
                if any(word in run.input for word in ("优先", "急", "破损"))
                else "normal"
            )
            selected_tool = self._resolve_bound_tool(
                db, run, "create_ticket"
            )
            if selected_tool and selected_tool.requires_approval:
                approval = Approval(
                    id=str(uuid.uuid4()),
                    run_id=run.id,
                    status="pending",
                    reason=(
                        "创建客服工单被策略标记为敏感操作，"
                        "需要人工确认后执行。"
                    ),
                    requested_at=datetime.utcnow(),
                )
                db.add(approval)
                run.status = "waiting_approval"
                run.resume_action = "create_ticket"
                self.add_event(
                    db,
                    run,
                    "approval.requested",
                    "工单工具等待人工审批",
                    {
                        "approval_id": approval.id,
                        "tool_id": selected_tool.id,
                        "tool": "create_ticket",
                        "arguments": {
                            "subject": run.input,
                            "priority": priority,
                        },
                        "policy": "mcp-tool-approval",
                    },
                    latency_ms=0,
                )
                run.output = "创建工单需要人工确认，系统已保存执行检查点。"
                run.input_tokens = max(
                    1,
                    len(f"{version.system_prompt}{run.input}") // 2,
                )
                run.output_tokens = max(1, len(run.output) // 2)
                run.latency_ms = int(
                    (time.perf_counter() - started) * 1000
                )
                run.cost_cents = round(
                    (run.input_tokens + run.output_tokens) / 1000 * 0.15,
                    3,
                )
                db.commit()
                db.refresh(run)
                return run
            result = self._execute_bound_tool(
                db,
                run,
                "create_ticket",
                {"subject": run.input, "priority": priority},
                run.fault_mode,
                idempotency_key=f"create-ticket:{run.id}",
            )
            self._record_tool_attempt(db, run, "create_ticket", result)
            if not result.ok:
                self._finish_run(
                    db,
                    run,
                    status="failed",
                    output=f"工单创建失败：{result.error}。系统已记录失败事件，可稍后重试。",
                    started=started,
                    facts={"intent": intent, "error": result.error},
                )
                return run
            ticket = result.data
            self._finish_run(
                db,
                run,
                status="completed",
                output=(
                    f"已创建工单 {ticket['ticket_id']}，优先级为"
                    f"{'高' if priority == 'high' else '普通'}，已分配给{ticket['assignee']}。"
                ),
                started=started,
                facts={"intent": intent, "ticket": ticket},
            )
            return run

        order_id = self.extract_order_id(run.input)
        if not order_id:
            self._finish_run(
                db,
                run,
                status="needs_input",
                output="请提供需要处理的订单号，例如 ORD-2026-1042。",
                started=started,
                facts={"intent": intent, "missing": ["order_id"]},
            )
            return run

        order_result = self._execute_bound_tool(
            db,
            run,
            "get_order",
            {"order_id": order_id},
            run.fault_mode,
        )
        self._record_tool_attempt(db, run, "get_order", order_result)
        if not order_result.ok:
            self._finish_run(
                db,
                run,
                status="failed",
                output=f"订单查询失败：{order_result.error}。",
                started=started,
                facts={"intent": intent, "error": order_result.error},
            )
            return run

        order = order_result.data
        if intent == "order_lookup":
            fallback = (
                f"订单 {order['id']} 当前状态为「{order['status']}」，"
                f"商品是 {order['product']}，实付 ¥{order['amount']:.2f}。"
            )
            self._finish_run(
                db,
                run,
                status="completed",
                output=fallback,
                started=started,
                facts={"intent": intent, "order": order},
            )
            return run

        reason = "用户申请退款"
        approval_reason = (
            f"订单 {order['id']} 的退款金额为 ¥{order['amount']:.2f}。"
            "执行退款属于敏感写操作，需要运营主管审批。"
        )
        if order.get("category") == "custom":
            approval_reason += " 该商品为定制商品，需要额外核对质量问题凭证。"
        approval = Approval(
            id=str(uuid.uuid4()),
            run_id=run.id,
            status="pending",
            reason=approval_reason,
            requested_at=datetime.utcnow(),
        )
        db.add(approval)
        run.status = "waiting_approval"
        self.add_event(
            db,
            run,
            "approval.requested",
            "敏感操作等待人工审批",
            {
                "approval_id": approval.id,
                "tool": "issue_refund",
                "arguments": {
                    "order_id": order["id"],
                    "amount": order["amount"],
                    "reason": reason,
                },
                "policy": "refund-write-approval",
            },
            latency_ms=43,
        )
        run.output = (
            f"订单已核实，退款金额 ¥{order['amount']:.2f}。"
            "该操作需要运营主管审批，审批通过后将继续执行。"
        )
        run.input_tokens = max(
            1, len(f"{version.system_prompt}{run.input}") // 2
        )
        run.output_tokens = max(1, len(run.output) // 2)
        run.latency_ms = int((time.perf_counter() - started) * 1000)
        run.cost_cents = round(
            (run.input_tokens + run.output_tokens) / 1000 * 0.15, 3
        )
        db.commit()
        db.refresh(run)
        return run

    def decide_approval(
        self,
        db: Session,
        approval: Approval,
        approved: bool,
        decided_by: str,
        note: str,
    ) -> Run:
        if approval.status != "pending":
            raise ValueError("该审批已经处理")
        run = db.query(Run).filter(Run.id == approval.run_id).first()
        if not run:
            raise ValueError("审批关联的运行不存在")
        approval.status = "approved" if approved else "rejected"
        approval.decided_at = datetime.utcnow()
        approval.decided_by = decided_by
        approval.note = note
        self.add_event(
            db,
            run,
            "approval.resolved",
            "审批已通过" if approved else "审批已驳回",
            {
                "approved": approved,
                "decided_by": decided_by,
                "note": note,
            },
            latency_ms=35,
        )
        if not approved:
            run.status = "rejected"
            run.output = (
                "退款申请已被驳回，未执行任何资金操作。"
                if run.resume_action == "issue_refund"
                else "敏感工具调用已被驳回，未执行任何写操作。"
            )
            run.finished_at = datetime.utcnow()
            run.resume_action = ""
            self.add_event(
                db,
                run,
                "run.rejected",
                "运行已结束 · 审批驳回",
                {"approval_id": approval.id},
                latency_ms=0,
            )
            db.commit()
            db.refresh(run)
            return run

        run.status = "queued"
        run.resume_action = run.resume_action or "issue_refund"
        run.worker_id = None
        run.lease_expires_at = None
        run.heartbeat_at = None
        self.add_event(
            db,
            run,
            "run.queued",
            "审批通过，运行重新入队",
            {
                "approval_id": approval.id,
                "resume_action": run.resume_action,
            },
            latency_ms=0,
        )
        db.commit()
        db.refresh(run)
        return run

    def resume_after_approval(self, db: Session, run: Run) -> Run:
        started = time.perf_counter()
        self.add_event(
            db,
            run,
            "run.resumed",
            "从审批检查点恢复",
            {
                "resume_action": run.resume_action,
                "attempt": run.attempt_count,
                "worker_id": run.worker_id,
            },
            latency_ms=0,
        )
        if run.resume_action == "create_ticket":
            priority = (
                "high"
                if any(word in run.input for word in ("优先", "急", "破损"))
                else "normal"
            )
            result = self._execute_bound_tool(
                db,
                run,
                "create_ticket",
                {"subject": run.input, "priority": priority},
                run.fault_mode,
                idempotency_key=f"create-ticket:{run.id}",
            )
            self._record_tool_attempt(db, run, "create_ticket", result)
            run.resume_action = ""
            if not result.ok:
                self._finish_run(
                    db,
                    run,
                    status="failed",
                    output=f"审批后创建工单失败：{result.error}",
                    started=started,
                    facts={"tool": "create_ticket", "error": result.error},
                )
                return run
            ticket = result.data
            self._finish_run(
                db,
                run,
                status="completed",
                output=(
                    f"已创建工单 {ticket.get('ticket_id', 'UNKNOWN')}，"
                    f"优先级为{'高' if priority == 'high' else '普通'}。"
                ),
                started=started,
                facts={"tool": "create_ticket", "ticket": ticket},
            )
            return run
        order_id = self.extract_order_id(run.input)
        order_result = self._execute_bound_tool(
            db,
            run,
            "get_order",
            {"order_id": order_id},
        )
        if not order_result.ok:
            run.status = "failed"
            run.output = f"审批通过后重新读取订单失败：{order_result.error}"
            run.finished_at = datetime.utcnow()
            run.resume_action = ""
            db.commit()
            db.refresh(run)
            return run
        order = order_result.data
        refund_result = self._execute_bound_tool(
            db,
            run,
            "issue_refund",
            {
                "order_id": order["id"],
                "amount": order["amount"],
                "reason": "用户申请退款",
            },
            "tool_timeout" if run.fault_mode == "tool_timeout" else "",
            idempotency_key=f"issue-refund:{run.id}",
        )
        self._record_tool_attempt(db, run, "issue_refund", refund_result)
        if not refund_result.ok:
            run.status = "failed"
            run.output = f"退款执行失败：{refund_result.error}"
            run.finished_at = datetime.utcnow()
            run.resume_action = ""
            db.commit()
            db.refresh(run)
            return run

        refund = refund_result.data
        fallback = (
            f"退款已受理，退款单号 {refund['refund_id']}，金额 "
            f"¥{refund['amount']:.2f}，将原路退回到支付账户。"
        )
        response = self.model.compose_answer(
            run.input,
            {"order": order, "refund": refund},
            fallback,
        )
        run.status = "completed"
        run.output = response.text
        run.input_tokens += response.input_tokens
        run.output_tokens += response.output_tokens
        run.cost_cents = round(
            (run.input_tokens + run.output_tokens) / 1000 * 0.15, 3
        )
        run.finished_at = datetime.utcnow()
        run.latency_ms += refund_result.latency_ms
        run.resume_action = ""
        self.add_event(
            db,
            run,
            "run.completed",
            "退款执行完成",
            {
                "refund": refund,
                "provider": response.provider,
                "tokens": {
                    "input": run.input_tokens,
                    "output": run.output_tokens,
                },
                "cost_cents": run.cost_cents,
            },
            latency_ms=response.output_tokens * 2,
        )
        db.commit()
        db.refresh(run)
        return run

    def _resolve_bound_tool(
        self,
        db: Session,
        run: Run,
        logical_name: str,
    ) -> Optional[Tool]:
        bound_tools = (
            db.query(Tool)
            .join(
                AgentTool,
                AgentTool.tool_id == Tool.id,
            )
            .filter(
                AgentTool.agent_version_id == run.agent_version_id,
                Tool.enabled.is_(True),
                (
                    (Tool.remote_name == logical_name)
                    | (Tool.slug == logical_name)
                ),
            )
            .all()
        )
        if not bound_tools:
            return None
        return sorted(
            bound_tools,
            key=lambda item: item.kind == "mcp",
            reverse=True,
        )[0]

    def _execute_bound_tool(
        self,
        db: Session,
        run: Run,
        logical_name: str,
        arguments: dict,
        fault_mode: str = "",
        idempotency_key: Optional[str] = None,
    ):
        selected = self._resolve_bound_tool(db, run, logical_name)
        if not selected:
            return ToolResult(
                ok=False,
                data={},
                attempts=0,
                latency_ms=0,
                error=f"Agent 版本未绑定工具：{logical_name}",
            )
        if selected.kind != "mcp":
            result = execute_tool(
                selected.slug,
                arguments,
                fault_mode,
                idempotency_key=idempotency_key,
            )
            result.tool_id = selected.id
            result.source = "builtin"
            return result

        server = (
            db.query(MCPServer)
            .filter(MCPServer.id == selected.mcp_server_id)
            .first()
        )
        if not server:
            return ToolResult(
                ok=False,
                data={},
                attempts=0,
                latency_ms=0,
                error="MCP Server 配置不存在",
                source="mcp",
                tool_id=selected.id,
                remote_name=selected.remote_name,
            )
        if selected.idempotent:
            for event in reversed(run.events):
                if event.type != "tool.completed":
                    continue
                payload = parse_event_payload(event)
                if (
                    payload.get("tool_id") == selected.id
                    and payload.get("ok") is True
                ):
                    return ToolResult(
                        ok=True,
                        data=payload.get("result") or {},
                        attempts=0,
                        latency_ms=0,
                        reused=True,
                        source="mcp",
                        tool_id=selected.id,
                        mcp_server_id=server.id,
                        remote_name=selected.remote_name,
                    )
        try:
            payload = mcp_bridge.call(
                server.bridge_server_id,
                selected.remote_name or logical_name,
                arguments,
            )
            data = payload.get("structuredContent")
            if data is None:
                text_content = next(
                    (
                        item.get("text")
                        for item in payload.get("content", [])
                        if item.get("type") == "text"
                    ),
                    "",
                )
                try:
                    data = json.loads(text_content) if text_content else {}
                except json.JSONDecodeError:
                    data = {"text": text_content}
            data = redact_sensitive_data(data)
            error_text = ""
            if payload.get("isError"):
                error_text = next(
                    (
                        item.get("text", "")
                        for item in payload.get("content", [])
                        if item.get("type") == "text"
                    ),
                    "MCP 工具返回错误",
                )
            return ToolResult(
                ok=payload.get("ok") is not False,
                data=data,
                attempts=1,
                latency_ms=int(payload.get("latencyMs", 0)),
                error=redact_sensitive_data(error_text),
                source="mcp",
                tool_id=selected.id,
                mcp_server_id=server.id,
                remote_name=selected.remote_name,
            )
        except MCPBridgeError as exc:
            return ToolResult(
                ok=False,
                data={},
                attempts=1,
                latency_ms=0,
                error=redact_sensitive_data(str(exc)),
                source="mcp",
                tool_id=selected.id,
                mcp_server_id=server.id,
                remote_name=selected.remote_name,
            )

    def _record_tool_attempt(
        self,
        db: Session,
        run: Run,
        slug: str,
        result,
    ) -> None:
        self.add_event(
            db,
            run,
            "tool.completed" if result.ok else "tool.failed",
            (
                f"工具调用 · {slug}"
                + (" · 已恢复" if result.ok and result.attempts > 1 else "")
            ),
            {
                "tool": slug,
                "tool_id": result.tool_id,
                "source": result.source,
                "mcp_server_id": result.mcp_server_id,
                "remote_name": result.remote_name,
                "ok": result.ok,
                "attempts": result.attempts,
                "idempotency_reused": result.reused,
                "result": result.data,
                "error": result.error or None,
            },
            latency_ms=result.latency_ms,
        )

    def _finish_run(
        self,
        db: Session,
        run: Run,
        status: str,
        output: str,
        started: float,
        facts: dict,
    ) -> None:
        response = self.model.compose_answer(run.input, facts, output)
        run.status = status
        run.output = response.text
        run.input_tokens = response.input_tokens
        run.output_tokens = response.output_tokens
        run.cost_cents = round(
            (run.input_tokens + run.output_tokens) / 1000 * 0.15, 3
        )
        run.latency_ms = int((time.perf_counter() - started) * 1000)
        run.finished_at = datetime.utcnow()
        self.add_event(
            db,
            run,
            f"run.{status}",
            (
                "运行已完成"
                if status == "completed"
                else ("需要补充信息" if status == "needs_input" else "运行失败")
            ),
            {
                "provider": response.provider,
                "tokens": {
                    "input": run.input_tokens,
                    "output": run.output_tokens,
                },
                "cost_cents": run.cost_cents,
            },
            latency_ms=response.output_tokens * 2,
        )
        db.commit()
        db.refresh(run)

    @staticmethod
    def _policy_answer(docs: List[RetrievedDocument]) -> str:
        if not docs:
            return "当前知识库没有检索到相关规则，建议创建人工工单进一步核实。"
        primary = docs[0]
        return f"根据《{primary.title}》：{primary.content}"
