from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, Optional


DEMO_ORDERS = {
    "ORD-2026-1042": {
        "id": "ORD-2026-1042",
        "customer": "陈嘉",
        "product": "Aurel 降噪耳机",
        "amount": 668.0,
        "status": "已签收 · 2 天前",
        "category": "electronics",
        "refundable": True,
    },
    "ORD-2026-0991": {
        "id": "ORD-2026-0991",
        "customer": "许言",
        "product": "定制胡桃木书桌",
        "amount": 2399.0,
        "status": "已签收 · 4 天前",
        "category": "custom",
        "refundable": True,
    },
    "ORD-2026-1088": {
        "id": "ORD-2026-1088",
        "customer": "赵语",
        "product": "旅行收纳套装",
        "amount": 329.0,
        "status": "已发货 · 运输中",
        "category": "accessories",
        "refundable": True,
    },
    "ORD-2026-1120": {
        "id": "ORD-2026-1120",
        "customer": "沈知",
        "product": "智能台灯 Pro",
        "amount": 899.0,
        "status": "待发货",
        "category": "electronics",
        "refundable": True,
    },
}

_IDEMPOTENCY_RESULTS: Dict[str, dict] = {}


@dataclass
class ToolResult:
    ok: bool
    data: dict
    attempts: int
    latency_ms: int
    error: str = ""
    reused: bool = False
    source: str = "builtin"
    tool_id: Optional[str] = None
    mcp_server_id: Optional[str] = None
    remote_name: Optional[str] = None


def validate_arguments(slug: str, arguments: dict) -> str:
    required = {
        "get_order": ["order_id"],
        "issue_refund": ["order_id", "amount", "reason"],
        "create_ticket": ["subject"],
        "search_policy": ["query"],
    }
    for key in required.get(slug, []):
        value = arguments.get(key)
        if value is None or (isinstance(value, str) and not value.strip()):
            return f"缺少必填参数：{key}"
    if slug == "issue_refund":
        try:
            amount = Decimal(str(arguments["amount"]))
        except Exception:
            return "参数 amount 必须是数字"
        if amount <= 0:
            return "参数 amount 必须大于 0"
    return ""


def execute_tool(
    slug: str,
    arguments: dict,
    fault_mode: str = "",
    max_attempts: int = 3,
    idempotency_key: Optional[str] = None,
) -> ToolResult:
    started = time.perf_counter()
    validation_error = validate_arguments(slug, arguments)
    if validation_error:
        return ToolResult(
            ok=False,
            data={},
            attempts=0,
            latency_ms=0,
            error=validation_error,
        )
    if idempotency_key and idempotency_key in _IDEMPOTENCY_RESULTS:
        return ToolResult(
            ok=True,
            data=dict(_IDEMPOTENCY_RESULTS[idempotency_key]),
            attempts=0,
            latency_ms=0,
            reused=True,
        )
    attempts = 0
    last_error = ""
    for attempt in range(1, max_attempts + 1):
        attempts = attempt
        if fault_mode == "slow_tool" and attempt == 1:
            time.sleep(15)
        if fault_mode == "tool_timeout" and attempt == 1:
            last_error = "工具请求超时（12,000ms）"
            time.sleep(0.05)
            continue
        if slug == "get_order":
            order_id = str(arguments.get("order_id", "")).upper()
            order = DEMO_ORDERS.get(order_id)
            latency = int((time.perf_counter() - started) * 1000)
            if not order:
                return ToolResult(
                    ok=False,
                    data={},
                    attempts=attempts,
                    latency_ms=latency,
                    error=f"未找到订单 {order_id or '（空）'}",
                )
            return ToolResult(
                ok=True,
                data=order,
                attempts=attempts,
                latency_ms=latency,
            )
        if slug == "issue_refund":
            amount = Decimal(str(arguments.get("amount", 0)))
            latency = int((time.perf_counter() - started) * 1000)
            data = {
                "refund_id": f"RF-{uuid.uuid4().hex[:8].upper()}",
                "order_id": arguments.get("order_id"),
                "amount": float(amount),
                "channel": "原支付渠道",
                "status": "processing",
            }
            if idempotency_key:
                data["idempotency_key"] = idempotency_key
                _IDEMPOTENCY_RESULTS[idempotency_key] = dict(data)
            return ToolResult(
                ok=True,
                data=data,
                attempts=attempts,
                latency_ms=latency,
            )
        if slug == "create_ticket":
            latency = int((time.perf_counter() - started) * 1000)
            fallback_ticket = {
                "ticket_id": f"TK-{uuid.uuid4().hex[:6].upper()}",
                "subject": arguments.get("subject", "客服请求"),
                "priority": arguments.get("priority", "normal"),
                "assignee": "售后支持组",
            }
            ticket_data = (
                _IDEMPOTENCY_RESULTS.setdefault(
                    idempotency_key, fallback_ticket
                )
                if idempotency_key
                else fallback_ticket
            )
            return ToolResult(
                ok=True,
                data=ticket_data,
                attempts=attempts,
                latency_ms=latency,
            )
        if slug == "search_policy":
            latency = int((time.perf_counter() - started) * 1000)
            return ToolResult(
                ok=True,
                data={"hits": 2, "collection": "refund-policy"},
                attempts=attempts,
                latency_ms=latency,
            )
        latency = int((time.perf_counter() - started) * 1000)
        return ToolResult(
            ok=False,
            data={},
            attempts=attempts,
            latency_ms=latency,
            error=f"未知工具：{slug}",
        )
    latency = int((time.perf_counter() - started) * 1000)
    return ToolResult(
        ok=False,
        data={},
        attempts=attempts,
        latency_ms=latency,
        error=last_error or "工具执行失败",
    )

