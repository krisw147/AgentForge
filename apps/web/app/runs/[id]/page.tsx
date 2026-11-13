"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  Coins,
  Copy,
  FileJson,
  Hash,
  Play,
  RotateCcw,
  ShieldCheck,
  X
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentMark } from "@/components/AgentMark";
import { LoadingState } from "@/components/LoadingState";
import { StatusBadge } from "@/components/StatusBadge";
import { TraceTimeline } from "@/components/TraceTimeline";
import { api } from "@/lib/api";
import {
  formatCost,
  formatDate,
  formatDuration,
  formatIntent,
  shortId
} from "@/lib/format";
import type { Run } from "@/lib/types";

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .run(id)
      .then(setRun)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      api
        .run(id)
        .then((value) => {
          if (!cancelled) setRun(value);
        })
        .catch(() => undefined);
    }, 600);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, run?.status]);

  const decide = async (approved: boolean) => {
    if (!run?.approval) return;
    setActing(true);
    try {
      const updated = await api.decideApproval(
        run.approval.id,
        approved,
        note || (approved ? "已核验，允许执行" : "风险未确认，驳回")
      );
      setRun(updated);
      setNote("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActing(false);
    }
  };

  const replay = async () => {
    setActing(true);
    try {
      const next = await api.replayRun(id);
      window.location.href = `/runs/${next.id}`;
    } catch (err) {
      setError((err as Error).message);
      setActing(false);
    }
  };

  const copyId = async () => {
    await navigator.clipboard.writeText(id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (loading) return <LoadingState label="正在加载执行 Trace" />;
  if (error || !run) {
    return <div className="error-panel">{error || "运行不存在"}</div>;
  }

  return (
    <>
      <Link className="back-link" href="/runs">
        <ArrowLeft size={15} />
        运行记录
      </Link>
      <header className="run-detail-header">
        <div>
          <div className="run-detail-title">
            <h1>运行 {shortId(run.id)}</h1>
            <StatusBadge status={run.status} />
          </div>
          <div className="run-detail-meta">
            <button onClick={copyId} type="button">
              <Hash size={14} />
              {copied ? "已复制" : run.id}
              <Copy size={12} />
            </button>
            <span>
              <Clock3 size={14} />
              {formatDate(run.startedAt)}
            </span>
            <span>
              <Play size={14} />
              {run.trigger}
            </span>
          </div>
        </div>
        <button
          className="button button--secondary"
          disabled={acting}
          onClick={replay}
          type="button"
        >
          <RotateCcw size={15} />
          回放运行
        </button>
      </header>

      {error ? (
        <div className="inline-alert inline-alert--danger">{error}</div>
      ) : null}

      {run.approval?.status === "pending" ? (
        <section className="approval-callout">
          <div className="approval-callout-icon">
            <ShieldCheck size={21} />
          </div>
          <div className="approval-callout-copy">
            <strong>执行已暂停，等待人工审批</strong>
            <p>{run.approval.reason}</p>
            <textarea
              onChange={(event) => setNote(event.target.value)}
              placeholder="填写审批备注（可选）"
              rows={2}
              value={note}
            />
          </div>
          <div className="approval-callout-actions">
            <button
              className="button button--danger-ghost"
              disabled={acting}
              onClick={() => decide(false)}
              type="button"
            >
              <X size={15} />
              驳回
            </button>
            <button
              className="button button--primary"
              disabled={acting}
              onClick={() => decide(true)}
              type="button"
            >
              <Check size={15} />
              {acting ? "处理中…" : "批准并继续"}
            </button>
          </div>
        </section>
      ) : null}

      <div className="run-detail-grid">
        <div className="detail-column-main">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <h2>输入与输出</h2>
                <p>Agent 最终对用户返回的内容</p>
              </div>
              <FileJson size={18} className="panel-heading-icon" />
            </div>
            <div className="message-pair">
              <div className="message-label">USER REQUEST</div>
              <div className="user-message">{run.input}</div>
              <div className="message-label agent-message-label">
                <AgentMark
                  icon={run.agent?.icon}
                  color={run.agent?.color}
                  size="sm"
                />
                AGENT RESPONSE
              </div>
              <div className="agent-message">{run.output}</div>
            </div>
          </article>

          <article className="panel trace-panel">
            <div className="panel-heading">
              <div>
                <h2>执行 Trace</h2>
                <p>按时间顺序持久化的事件与工具结果</p>
              </div>
              <span className="panel-chip">
                {run.events?.length || 0} EVENTS
              </span>
            </div>
            <TraceTimeline events={run.events} />
          </article>

          {run.approval ? (
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>审批记录</h2>
                  <p>敏感操作的人工决策链路</p>
                </div>
                <StatusBadge status={run.approval.status} />
              </div>
              <div className="approval-record">
                <div>
                  <span>审批原因</span>
                  <p>{run.approval.reason}</p>
                </div>
                <div>
                  <span>审批备注</span>
                  <p>{run.approval.note || "—"}</p>
                </div>
                <div>
                  <span>发起时间</span>
                  <p>{formatDate(run.approval.requestedAt)}</p>
                </div>
                <div>
                  <span>处理时间</span>
                  <p>{formatDate(run.approval.decidedAt)}</p>
                </div>
              </div>
            </article>
          ) : null}
        </div>

        <aside className="detail-column-side">
          <article className="panel">
            <div className="panel-heading panel-heading--compact">
              <div>
                <h2>运行摘要</h2>
                <p>本次执行的资源消耗</p>
              </div>
            </div>
            <div className="run-metric-list">
              <div>
                <span>
                  <Clock3 size={14} /> 总耗时
                </span>
                <strong>{formatDuration(run.latencyMs)}</strong>
              </div>
              <div>
                <span>
                  <Coins size={14} /> 模型成本
                </span>
                <strong>{formatCost(run.costCents)}</strong>
              </div>
              <div>
                <span>输入 Token</span>
                <strong>{run.inputTokens}</strong>
              </div>
              <div>
                <span>输出 Token</span>
                <strong>{run.outputTokens}</strong>
              </div>
              <div>
                <span>识别意图</span>
                <strong>{formatIntent(run.intent)}</strong>
              </div>
              <div>
                <span>故障注入</span>
                <strong>{run.faultMode || "无"}</strong>
              </div>
              <div>
                <span>Worker</span>
                <strong>{run.workerId || "尚未领取"}</strong>
              </div>
              <div>
                <span>执行尝试</span>
                <strong>{run.attemptCount}</strong>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading panel-heading--compact">
              <div>
                <h2>上下文</h2>
                <p>Agent 与版本</p>
              </div>
            </div>
            <Link
              className="context-agent-card"
              href={`/agents/${run.agent?.id}`}
            >
              <AgentMark
                icon={run.agent?.icon}
                color={run.agent?.color}
                size="md"
              />
              <div>
                <strong>{run.agent?.name}</strong>
                <span>版本 v{run.version}</span>
              </div>
              <ArrowLeft size={15} className="context-arrow" />
            </Link>
            <div className="prompt-mini">
              <span>System prompt</span>
              <p>{run.systemPrompt}</p>
            </div>
          </article>

          {run.status === "waiting_approval" ? (
            <div className="side-warning">
              <AlertTriangle size={17} />
              <p>安全检查点已保存。即使服务重启，审批后仍可继续执行。</p>
            </div>
          ) : run.status === "completed" ? (
            <div className="side-success">
              <CheckCircle2 size={17} />
              <p>运行已完成，所有事件和产物均已持久化。</p>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}
