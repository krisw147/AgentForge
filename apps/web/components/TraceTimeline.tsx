import {
  BrainCircuit,
  Check,
  CircleDashed,
  Database,
  GitBranch,
  ShieldCheck,
  TerminalSquare,
  Wrench
} from "lucide-react";
import type { RunEvent } from "@/lib/types";
import { formatDuration } from "@/lib/format";

const eventIcon = (type: string) => {
  if (type.includes("tool")) return Wrench;
  if (type.includes("retrieval")) return Database;
  if (type.includes("approval")) return ShieldCheck;
  if (type.includes("intent")) return BrainCircuit;
  if (type.includes("run")) return TerminalSquare;
  return GitBranch;
};

export function TraceTimeline({
  events = [],
  compact = false
}: {
  events?: RunEvent[];
  compact?: boolean;
}) {
  if (!events.length) {
    return <div className="timeline-empty">这次运行还没有可展示的执行事件。</div>;
  }
  return (
    <div className={`trace-timeline ${compact ? "trace-timeline--compact" : ""}`}>
      {events.map((event, index) => {
        const Icon = eventIcon(event.type);
        const isLast = index === events.length - 1;
        return (
          <div className="trace-item" key={event.id}>
            <div className="trace-rail">
              <span
                className={`trace-icon ${
                  event.type.includes("failed") ? "trace-icon--danger" : ""
                }`}
              >
                <Icon size={15} />
              </span>
              {!isLast ? <span className="trace-line" /> : null}
            </div>
            <div className="trace-body">
              <div className="trace-heading">
                <span>{event.title}</span>
                <span className="trace-latency">
                  {formatDuration(event.latencyMs)}
                </span>
              </div>
              {!compact ? (
                <pre className="trace-payload">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              ) : (
                <div className="trace-compact-copy">
                  {event.type.includes("tool")
                    ? "工具网关记录"
                    : event.type.includes("approval")
                      ? "审批状态变更"
                      : event.type.includes("retrieval")
                        ? "知识库检索"
                        : event.type.includes("intent")
                          ? "策略路由"
                          : "运行时事件"}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="timeline-end">
        <Check size={13} />
        所有事件已持久化
      </div>
    </div>
  );
}

