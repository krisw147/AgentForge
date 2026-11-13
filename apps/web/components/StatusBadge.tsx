const statusMap: Record<string, { label: string; tone: string }> = {
  queued: { label: "排队中", tone: "neutral" },
  completed: { label: "已完成", tone: "success" },
  running: { label: "运行中", tone: "info" },
  waiting_approval: { label: "等待审批", tone: "warning" },
  needs_input: { label: "需要补充", tone: "neutral" },
  failed: { label: "失败", tone: "danger" },
  rejected: { label: "已驳回", tone: "danger" },
  pending: { label: "待审批", tone: "warning" },
  approved: { label: "已通过", tone: "success" },
  active: { label: "运行中", tone: "success" },
  draft: { label: "草稿", tone: "neutral" },
  published: { label: "已发布", tone: "success" },
  superseded: { label: "历史版本", tone: "neutral" },
  simulation: { label: "评测已模拟", tone: "info" },
  connected: { label: "已连接", tone: "success" },
  disconnected: { label: "连接失败", tone: "danger" }
};

export function StatusBadge({
  status,
  label
}: {
  status: string;
  label?: string;
}) {
  const value = statusMap[status] || { label: status, tone: "neutral" };
  return (
    <span className={`status-badge status-badge--${value.tone}`}>
      <span className="status-dot" />
      {label || value.label}
    </span>
  );
}

