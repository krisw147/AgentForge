from __future__ import annotations

import json
import random
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

from sqlalchemy.orm import Session

from .config import settings
from .auth import hash_password
from .models import (
    Agent,
    AgentTool,
    AgentVersion,
    Approval,
    EvalCase,
    EvalDataset,
    EvalResult,
    EvalRun,
    KnowledgeDoc,
    Membership,
    Run,
    RunEvent,
    Tenant,
    Tool,
    User,
)


PRIMARY_TENANT_ID = "tenant-forward"
SECONDARY_TENANT_ID = "tenant-greenleaf"
PRIMARY_AGENT_ID = "agent-refund-ops"
PRIMARY_VERSION_ID = "version-refund-1-1"
SECONDARY_AGENT_ID = "agent-contract-review"
DEMO_PASSWORD = "demo1234"


def sync_configured_model(db: Session) -> None:
    if not settings.live_model_enabled:
        return
    versions = (
        db.query(AgentVersion)
        .filter(AgentVersion.model.like("demo-%"))
        .all()
    )
    for version in versions:
        version.model = settings.llm_model
    if versions:
        db.commit()


def ensure_auth_seed(db: Session) -> None:
    approver = db.query(User).filter(User.email == "chen@forward.tech").first()
    if not approver:
        approver = User(
            id="user-chen",
            tenant_id=PRIMARY_TENANT_ID,
            email="chen@forward.tech",
            name="陈默",
            role="approver",
        )
        db.add(approver)
        db.flush()

    users = db.query(User).all()
    for user in users:
        if not user.password_hash:
            user.password_hash = hash_password(DEMO_PASSWORD)

    assignments = [
        ("user-lin", PRIMARY_TENANT_ID, "owner"),
        ("user-lin", SECONDARY_TENANT_ID, "owner"),
        ("user-zhou", PRIMARY_TENANT_ID, "member"),
        ("user-qing", SECONDARY_TENANT_ID, "owner"),
        ("user-chen", PRIMARY_TENANT_ID, "approver"),
    ]
    for user_id, tenant_id, role in assignments:
        existing = (
            db.query(Membership)
            .filter(
                Membership.user_id == user_id,
                Membership.tenant_id == tenant_id,
            )
            .first()
        )
        if not existing:
            db.add(
                Membership(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    tenant_id=tenant_id,
                    role=role,
                )
            )
    db.commit()


TOOL_DEFINITIONS = [
    {
        "slug": "get_order",
        "name": "查询订单",
        "description": "根据订单号读取订单、客户、商品和实付金额。",
        "requires_approval": False,
        "schema": {
            "type": "object",
            "properties": {"order_id": {"type": "string"}},
            "required": ["order_id"],
        },
    },
    {
        "slug": "issue_refund",
        "name": "执行退款",
        "description": "对符合条件的订单发起退款，属于敏感写操作。",
        "requires_approval": True,
        "schema": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string"},
                "amount": {"type": "number"},
                "reason": {"type": "string"},
            },
            "required": ["order_id", "amount", "reason"],
        },
    },
    {
        "slug": "create_ticket",
        "name": "创建工单",
        "description": "将复杂问题升级给人工客服团队。",
        "requires_approval": False,
        "schema": {
            "type": "object",
            "properties": {
                "subject": {"type": "string"},
                "priority": {"type": "string"},
            },
            "required": ["subject"],
        },
    },
    {
        "slug": "search_policy",
        "name": "检索退款政策",
        "description": "从企业知识库检索退款规则和例外条款。",
        "requires_approval": False,
        "schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
]


def _add_event(
    db: Session,
    run: Run,
    seq: int,
    kind: str,
    title: str,
    payload: dict,
    latency_ms: int,
    created_at: datetime,
) -> None:
    db.add(
        RunEvent(
            id=f"{run.id}-event-{seq}",
            run_id=run.id,
            seq=seq,
            type=kind,
            title=title,
            payload_json=json.dumps(payload, ensure_ascii=False),
            latency_ms=latency_ms,
            created_at=created_at,
        )
    )


def seed_database(db: Session) -> None:
    if db.query(Tenant).first():
        return

    now = datetime.utcnow()
    tenants = [
        Tenant(
            id=PRIMARY_TENANT_ID,
            name="星河科技",
            slug="forward-tech",
            plan="team",
            created_at=now - timedelta(days=86),
        ),
        Tenant(
            id=SECONDARY_TENANT_ID,
            name="青禾零售",
            slug="greenleaf",
            plan="developer",
            created_at=now - timedelta(days=31),
        ),
    ]
    db.add_all(tenants)

    users = [
        User(
            id="user-lin",
            tenant_id=PRIMARY_TENANT_ID,
            email="lin@forward.tech",
            name="林澈",
            role="owner",
        ),
        User(
            id="user-zhou",
            tenant_id=PRIMARY_TENANT_ID,
            email="zhou@forward.tech",
            name="周宁",
            role="member",
        ),
        User(
            id="user-qing",
            tenant_id=SECONDARY_TENANT_ID,
            email="qing@greenleaf.cn",
            name="沈青",
            role="owner",
        ),
    ]
    db.add_all(users)

    agents = [
        Agent(
            id=PRIMARY_AGENT_ID,
            tenant_id=PRIMARY_TENANT_ID,
            name="退款运营助手",
            description="查询订单、核对退款政策，并在敏感操作前请求人工审批。",
            icon="RF",
            color="violet",
            status="active",
            created_at=now - timedelta(days=33),
        ),
        Agent(
            id="agent-ticket-router",
            tenant_id=PRIMARY_TENANT_ID,
            name="客服工单分诊",
            description="识别用户意图、评估优先级并创建客服工单。",
            icon="TR",
            color="blue",
            status="active",
            created_at=now - timedelta(days=20),
        ),
        Agent(
            id=SECONDARY_AGENT_ID,
            tenant_id=SECONDARY_TENANT_ID,
            name="合同审阅助手",
            description="提取合同风险条款，输出结构化审阅建议。",
            icon="CR",
            color="emerald",
            status="draft",
            created_at=now - timedelta(days=9),
        ),
    ]
    db.add_all(agents)

    versions = [
        AgentVersion(
            id="version-refund-1-0",
            agent_id=PRIMARY_AGENT_ID,
            version="1.0.0",
            model="demo-deterministic",
            system_prompt="你是退款运营助手。先核实订单，再依据退款政策决定下一步。",
            max_steps=6,
            budget_cents=15,
            config_json=json.dumps(
                {"temperature": 0.1, "retrieval": "lexical", "trace": True}
            ),
            status="superseded",
            created_at=now - timedelta(days=33),
        ),
        AgentVersion(
            id=PRIMARY_VERSION_ID,
            agent_id=PRIMARY_AGENT_ID,
            version="1.1.0",
            model="demo-deterministic",
            system_prompt=(
                "你是企业退款运营助手。必须先查询订单，再检索退款政策；"
                "金额超过 500 元或执行退款时请求人工审批。"
            ),
            max_steps=8,
            budget_cents=20,
            config_json=json.dumps(
                {
                    "temperature": 0.1,
                    "retrieval": "lexical",
                    "trace": True,
                    "fallback": "manual-review",
                }
            ),
            status="published",
            created_at=now - timedelta(days=6),
        ),
        AgentVersion(
            id="version-ticket-1-0",
            agent_id="agent-ticket-router",
            version="1.0.0",
            model="demo-deterministic",
            system_prompt="识别客服问题并创建工单。",
            max_steps=5,
            budget_cents=10,
            config_json="{}",
            created_at=now - timedelta(days=20),
        ),
        AgentVersion(
            id="version-contract-0-8",
            agent_id=SECONDARY_AGENT_ID,
            version="0.8.0",
            model="demo-deterministic",
            system_prompt="提取合同中的风险条款并给出审阅建议。",
            max_steps=6,
            budget_cents=12,
            config_json="{}",
            status="draft",
            created_at=now - timedelta(days=9),
        ),
    ]
    db.add_all(versions)
    db.flush()

    tool_rows: Dict[Tuple[str, str], Tool] = {}
    for tenant in tenants:
        for item in TOOL_DEFINITIONS:
            tool = Tool(
                id=f"tool-{tenant.slug}-{item['slug']}",
                tenant_id=tenant.id,
                slug=item["slug"],
                name=item["name"],
                description=item["description"],
                input_schema_json=json.dumps(item["schema"], ensure_ascii=False),
                requires_approval=item["requires_approval"],
            )
            tool_rows[(tenant.id, item["slug"])] = tool
            db.add(tool)
    db.flush()

    for version_id, tenant_id in (
        ("version-refund-1-0", PRIMARY_TENANT_ID),
        (PRIMARY_VERSION_ID, PRIMARY_TENANT_ID),
        ("version-ticket-1-0", PRIMARY_TENANT_ID),
        ("version-contract-0-8", SECONDARY_TENANT_ID),
    ):
        for slug in ("get_order", "issue_refund", "create_ticket", "search_policy"):
            db.add(
                AgentTool(
                    agent_version_id=version_id,
                    tool_id=tool_rows[(tenant_id, slug)].id,
                )
            )

    docs = [
        KnowledgeDoc(
            id="doc-refund-standard",
            tenant_id=PRIMARY_TENANT_ID,
            title="标准退款政策",
            source="refund-policy-v3.md",
            content=(
                "签收后 7 天内且商品未影响二次销售，可申请无理由退款。"
                "500 元以下退款可由客服直接处理；超过 500 元需运营主管审批。"
            ),
        ),
        KnowledgeDoc(
            id="doc-refund-special",
            tenant_id=PRIMARY_TENANT_ID,
            title="特殊商品退款规则",
            source="special-goods.md",
            content=(
                "定制商品、生鲜和已激活的电子产品原则上不支持无理由退款。"
                "质量问题需要上传凭证并由人工客服复核。"
            ),
        ),
        KnowledgeDoc(
            id="doc-refund-sla",
            tenant_id=PRIMARY_TENANT_ID,
            title="退款时效与通知",
            source="service-sla.md",
            content=(
                "审核通过后 1 个工作日内原路退款，到账时间以支付渠道为准。"
                "退款完成后应通知用户并记录支付渠道流水号。"
            ),
        ),
    ]
    db.add_all(docs)

    dataset = EvalDataset(
        id="dataset-refund-regression",
        tenant_id=PRIMARY_TENANT_ID,
        name="退款流程回归集",
        description="覆盖小额自动退款、大额审批、订单查询和政策问答。",
        created_at=now - timedelta(days=12),
    )
    db.add(dataset)
    db.flush()
    case_data = [
        (
            "大额退款审批",
            "订单 ORD-2026-1042 的耳机不合适，我要申请退款。",
            "refund",
            "waiting_approval",
        ),
        (
            "普通订单查询",
            "帮我查一下订单 ORD-2026-1042 现在是什么状态？",
            "order_lookup",
            "completed",
        ),
        (
            "退款政策问答",
            "超过 7 天的商品还能无理由退款吗？",
            "policy_question",
            "completed",
        ),
        (
            "客服工单创建",
            "商品包装破损，请帮我创建优先工单。",
            "ticket",
            "completed",
        ),
        (
            "特殊商品退款",
            "订单 ORD-2026-0991 是定制商品，但尺寸有问题，可以退款吗？",
            "refund",
            "waiting_approval",
        ),
        (
            "不完整退款请求",
            "我想退一下。",
            "refund",
            "needs_input",
        ),
        (
            "订单加急",
            "订单 ORD-2026-1088 请尽快处理。",
            "order_lookup",
            "completed",
        ),
        (
            "售后时效",
            "退款审核通过后多久能到账？",
            "policy_question",
            "completed",
        ),
    ]
    cases: List[EvalCase] = []
    for index, (name, prompt, intent, outcome) in enumerate(case_data, start=1):
        case = EvalCase(
            id=f"eval-case-{index}",
            dataset_id=dataset.id,
            position=index,
            name=name,
            input=prompt,
            expected_intent=intent,
            expected_outcome=outcome,
            tags_json=json.dumps(["refund"], ensure_ascii=False),
        )
        cases.append(case)
        db.add(case)

    eval_specs = [
        (
            "eval-run-v10",
            "version-refund-1-0",
            0.75,
            0.75,
            742,
            0.82,
            6,
            now - timedelta(days=7),
        ),
        (
            "eval-run-v11",
            PRIMARY_VERSION_ID,
            1.0,
            1.0,
            688,
            0.74,
            8,
            now - timedelta(days=1, hours=3),
        ),
    ]
    for spec in eval_specs:
        (
            eval_id,
            version_id,
            accuracy,
            success_rate,
            p95,
            avg_cost,
            passed,
            created_at,
        ) = spec
        eval_run = EvalRun(
            id=eval_id,
            tenant_id=PRIMARY_TENANT_ID,
            dataset_id=dataset.id,
            agent_id=PRIMARY_AGENT_ID,
            agent_version_id=version_id,
            status="completed",
            accuracy=accuracy,
            success_rate=success_rate,
            p95_latency_ms=p95,
            avg_cost_cents=avg_cost,
            passed_cases=passed,
            total_cases=len(cases),
            created_at=created_at,
            finished_at=created_at + timedelta(seconds=8),
        )
        db.add(eval_run)
        for index, case in enumerate(cases):
            passed_case = index < passed
            actual_intent = (
                case.expected_intent if passed_case else "policy_question"
            )
            actual_outcome = (
                case.expected_outcome if passed_case else "completed"
            )
            db.add(
                EvalResult(
                    id=f"{eval_id}-result-{index + 1}",
                    eval_run_id=eval_id,
                    case_id=case.id,
                    case_name=case.name,
                    input=case.input,
                    actual_intent=actual_intent,
                    actual_outcome=actual_outcome,
                    expected_intent=case.expected_intent,
                    expected_outcome=case.expected_outcome,
                    passed=passed_case,
                    latency_ms=410 + index * 43,
                    cost_cents=avg_cost,
                    created_at=created_at + timedelta(seconds=2),
                )
            )

    random.seed(42)
    run_inputs = [
        ("订单 ORD-2026-1042 的耳机不合适，我要申请退款。", "refund"),
        ("帮我查一下订单 ORD-2026-1088 的物流。", "order_lookup"),
        ("退款审核通过后多久到账？", "policy_question"),
        ("订单 ORD-2026-0991 是定制商品，尺寸有问题。", "refund"),
        ("包装破损，帮我创建一个优先工单。", "ticket"),
        ("订单 ORD-2026-1042 能不能退？", "refund"),
        ("我想修改收货地址。", "unknown"),
        ("生鲜商品可以无理由退款吗？", "policy_question"),
        ("请帮我查一下订单 ORD-2026-1120。", "order_lookup"),
        ("退款金额为什么还没到账？", "refund"),
        ("订单 ORD-2026-1088 一直没发货。", "ticket"),
        ("订单 ORD-2026-0991 是定制商品，有质量问题。", "refund"),
    ]
    for index, (prompt, intent) in enumerate(run_inputs, start=1):
        created_at = now - timedelta(days=5) + timedelta(hours=index * 8)
        requires_approval = index in (1, 4, 6, 10, 12)
        is_pending = index in (6, 12)
        status = (
            "waiting_approval"
            if is_pending
            else ("completed" if index not in (7,) else "failed")
        )
        run = Run(
            id=f"seed-run-{index:02d}",
            tenant_id=PRIMARY_TENANT_ID,
            agent_id=PRIMARY_AGENT_ID,
            agent_version_id=PRIMARY_VERSION_ID,
            user_id="user-lin",
            status=status,
            input=prompt,
            output=(
                "已创建退款审批，等待运营主管确认。"
                if status == "waiting_approval"
                else (
                    "没有识别到可执行动作，请补充订单号或具体诉求。"
                    if status == "failed"
                    else "请求已处理完成。"
                )
            ),
            intent=intent,
            cost_cents=round(0.4 + random.random() * 0.7, 2),
            input_tokens=random.randint(180, 380),
            output_tokens=random.randint(30, 90),
            latency_ms=random.randint(540, 1280),
            trigger="api" if index % 3 == 0 else "playground",
            started_at=created_at,
            finished_at=(
                None if is_pending else created_at + timedelta(seconds=1)
            ),
        )
        db.add(run)
        _add_event(
            db,
            run,
            1,
            "run.started",
            "运行已创建",
            {"model": "demo-deterministic", "max_steps": 8},
            31,
            created_at,
        )
        _add_event(
            db,
            run,
            2,
            "intent.detected",
            f"识别意图 · {intent}",
            {"confidence": 0.94, "intent": intent},
            86,
            created_at + timedelta(milliseconds=280),
        )
        _add_event(
            db,
            run,
            3,
            "retrieval.completed",
            "检索企业知识库",
            {
                "documents": [
                    {
                        "title": "标准退款政策",
                        "source": "refund-policy-v3.md",
                        "score": 0.91,
                    }
                ]
            },
            112,
            created_at + timedelta(milliseconds=430),
        )
        if requires_approval:
            approval = Approval(
                id=f"seed-approval-{index:02d}",
                run_id=run.id,
                status="pending" if is_pending else "approved",
                reason="退款属于敏感写操作，需要运营主管确认。",
                requested_at=created_at + timedelta(milliseconds=900),
                decided_at=(
                    None
                    if is_pending
                    else created_at + timedelta(minutes=3)
                ),
                decided_by=None if is_pending else "user-lin",
                note="" if is_pending else "核验无误，允许退款。",
            )
            db.add(approval)

    db.commit()
