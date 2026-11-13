export function formatDate(value?: string | null, includeTime = true): string {
  if (!value) return "—";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    ...(includeTime
      ? { hour: "2-digit", minute: "2-digit" }
      : { year: "numeric" })
  }).format(date);
}

export function formatDuration(ms?: number): string {
  if (!ms) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
}

export function formatCost(cents?: number): string {
  const value = Number(cents || 0);
  if (value < 0.1) return `$${(value / 100).toFixed(5)}`;
  if (value < 1) return `$${(value / 100).toFixed(4)}`;
  return `$${(value / 100).toFixed(2)}`;
}

export function formatIntent(intent?: string): string {
  const labels: Record<string, string> = {
    refund: "退款申请",
    order_lookup: "订单查询",
    policy_question: "政策问答",
    ticket: "客服工单",
    unknown: "未知意图"
  };
  return labels[intent || ""] || intent || "—";
}

export function formatOutcome(outcome?: string): string {
  const labels: Record<string, string> = {
    completed: "已完成",
    waiting_approval: "等待审批",
    needs_input: "需要补充",
    failed: "失败",
    rejected: "已驳回"
  };
  return labels[outcome || ""] || outcome || "—";
}

export function shortId(value?: string | null): string {
  if (!value) return "—";
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

