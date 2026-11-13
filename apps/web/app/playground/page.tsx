"use client";

import {
  ArrowRight,
  Bot,
  Braces,
  CheckCircle2,
  Clock3,
  FlaskConical,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Terminal,
  TimerReset,
  WandSparkles,
  Zap
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AgentMark } from "@/components/AgentMark";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { TraceTimeline } from "@/components/TraceTimeline";
import { api, runStreamUrl } from "@/lib/api";
import { formatCost, formatDuration, formatIntent } from "@/lib/format";
import type { AgentSummary, Run } from "@/lib/types";

const examples = [
  "订单 ORD-2026-1042 的耳机不合适，我要申请退款。",
  "帮我查一下订单 ORD-2026-1088 现在是什么状态？",
  "超过 7 天的商品还能无理由退款吗？",
  "包装破损，请帮我创建一个优先工单。"
];

export default function PlaygroundPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState(examples[0]);
  const [faultMode, setFaultMode] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const queryAgent = new URLSearchParams(window.location.search).get("agent");
    api
      .agents()
      .then((items) => {
        const runnable = items.filter((item) => item.latestVersion);
        setAgents(runnable);
        setAgentId(
          queryAgent && runnable.some((item) => item.id === queryAgent)
            ? queryAgent
            : runnable[0]?.id || ""
        );
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(
    () => () => {
      streamRef.current?.close();
    },
    []
  );

  const execute = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!agentId || !prompt.trim()) return;
    setRunning(true);
    setError("");
    setRun(null);
    streamRef.current?.close();
    try {
      const created = await api.createRun({
        agent_id: agentId,
        input: prompt.trim(),
        fault_mode: faultMode
      });
      setRun(created);
      const stream = new EventSource(runStreamUrl(created.id), {
        withCredentials: true
      });
      streamRef.current = stream;
      stream.addEventListener("snapshot", (event) => {
        setRun(JSON.parse((event as MessageEvent).data));
      });
      stream.addEventListener("done", (event) => {
        setRun(JSON.parse((event as MessageEvent).data));
        setRunning(false);
        stream.close();
        streamRef.current = null;
      });
      stream.onerror = () => {
        if (stream.readyState === EventSource.CLOSED) {
          setError("实时事件流中断，请刷新运行记录查看最终状态。");
          setRunning(false);
        }
      };
    } catch (err) {
      setError((err as Error).message);
      setRunning(false);
    }
  };

  const selected = agents.find((agent) => agent.id === agentId);

  if (loading) return <LoadingState label="正在准备 Playground" />;

  return (
    <>
      <PageHeader
        eyebrow="EXECUTION LAB"
        title="Playground"
        description="运行 Agent、注入故障并检查每一步决策。每次运行都会生成可回放的 Trace。"
        actions={
          <span className="live-indicator">
            <span />
            Runtime connected
          </span>
        }
      />

      <div className="playground-layout">
        <form className="playground-config panel" onSubmit={execute}>
          <div className="panel-heading panel-heading--compact">
            <div>
              <h2>运行配置</h2>
              <p>选择一个已发布版本</p>
            </div>
            <FlaskConical size={18} className="panel-heading-icon" />
          </div>

          <label className="field-label">
            <span>Agent</span>
            <div className="select-field">
              <Bot size={16} />
              <select
                onChange={(event) => setAgentId(event.target.value)}
                value={agentId}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · v{agent.latestVersion?.version}
                  </option>
                ))}
              </select>
            </div>
          </label>

          {selected ? (
            <div className="selected-agent-summary">
              <AgentMark
                icon={selected.icon}
                color={selected.color}
                size="sm"
              />
              <div>
                <strong>{selected.name}</strong>
                <span>{selected.latestVersion?.model}</span>
              </div>
              <code>v{selected.latestVersion?.version}</code>
            </div>
          ) : null}

          {!agents.length ? (
            <div className="inline-alert inline-alert--danger">
              当前没有已发布的 Agent 版本，请先在 Agent 版本页通过评测门禁。
            </div>
          ) : null}

          <label className="field-label">
            <span>用户请求</span>
            <textarea
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="输入用户的真实请求…"
              rows={5}
              value={prompt}
            />
            <span className="field-hint">{prompt.length} / 8,000</span>
          </label>

          <div className="example-list">
            <span>快速示例</span>
            {examples.slice(0, 3).map((example) => (
              <button
                key={example}
                onClick={() => setPrompt(example)}
                type="button"
              >
                <WandSparkles size={13} />
                {example}
              </button>
            ))}
          </div>

          <div className="field-label">
            <span>故障注入</span>
            <div className="fault-options">
              {[
                ["", "正常运行", Zap],
                ["tool_timeout", "首次工具超时", Clock3],
                ["slow_tool", "慢工具（15 秒）", TimerReset],
                ["force_approval", "强制人工审批", ShieldAlert]
              ].map(([value, label, Icon]) => (
                <button
                  className={
                    faultMode === value
                      ? "fault-option active"
                      : "fault-option"
                  }
                  key={String(value)}
                  onClick={() => setFaultMode(String(value))}
                  type="button"
                >
                  <Icon size={15} />
                  {String(label)}
                </button>
              ))}
            </div>
          </div>

          <button
            className="button button--primary button--run"
            disabled={running || !agentId}
            type="submit"
          >
            {running ? (
              <>
                <span className="spinner spinner--light" />
                正在执行
              </>
            ) : (
              <>
                <Play size={17} fill="currentColor" />
                运行 Agent
              </>
            )}
          </button>
          <div className="run-shortcut">
            <span>每次运行都会持久化检查点</span>
            <kbd>⌘ ↵</kbd>
          </div>
        </form>

        <section className="playground-result">
          {error ? (
            <div className="inline-alert inline-alert--danger">{error}</div>
          ) : null}
          {!run && !running ? (
            <div className="panel playground-empty">
              <EmptyState
                icon={Terminal}
                title="准备执行一次运行"
                description="选择左侧 Agent 和故障场景，然后发送请求。你将在这里看到模型输出、工具调用、审批与检查点。"
              />
              <div className="execution-flow">
                {[
                  ["01", "理解意图", Braces],
                  ["02", "检索知识", Sparkles],
                  ["03", "调用工具", Zap],
                  ["04", "记录 Trace", CheckCircle2]
                ].map(([number, label, Icon]) => (
                  <div className="execution-flow-step" key={String(number)}>
                    <span>{String(number)}</span>
                    <Icon size={17} />
                    <strong>{String(label)}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!run && running ? (
            <div className="panel playground-running">
              <div className="running-orbit">
                <span />
                <Sparkles size={25} />
              </div>
              <strong>Agent 正在执行</strong>
              <p>正在加载检查点、检索知识库并校验工具权限…</p>
              <div className="skeleton-lines">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}

          {run ? (
            <>
              <article className="panel run-result-card">
                <div className="panel-heading">
                  <div className="result-title">
                    <span className="result-icon">
                      <Sparkles size={18} />
                    </span>
                    <div>
                      <h2>运行结果</h2>
                      <p>
                        <code>{run.id.slice(0, 8)}</code> · {formatIntent(run.intent)}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={run.status} />
                </div>
                <div className="assistant-bubble">
                  <div className="assistant-label">
                    <AgentMark
                      icon={run.agent?.icon}
                      color={run.agent?.color}
                      size="sm"
                    />
                    <span>{run.agent?.name}</span>
                  </div>
                  <p>
                    {run.output ||
                      (run.status === "queued"
                        ? "运行已进入持久化队列，等待 Worker 领取…"
                        : "Worker 已领取任务，正在执行 Agent 步骤…")}
                  </p>
                  {run.approval?.status === "pending" ? (
                    <Link
                      className="approval-inline-cta"
                      href={`/runs/${run.id}`}
                    >
                      <ShieldAlert size={15} />
                      该操作已被安全暂停，前往审批
                      <ArrowRight size={14} />
                    </Link>
                  ) : null}
                </div>
                <div className="run-metrics">
                  <div>
                    <span>耗时</span>
                    <strong>{formatDuration(run.latencyMs)}</strong>
                  </div>
                  <div>
                    <span>模型成本</span>
                    <strong>{formatCost(run.costCents)}</strong>
                  </div>
                  <div>
                    <span>Token</span>
                    <strong>{run.inputTokens + run.outputTokens}</strong>
                  </div>
                  <div>
                    <span>执行步骤</span>
                    <strong>{run.events?.length || 0}</strong>
                  </div>
                </div>
                <div className="result-actions">
                  <Link className="button button--primary" href={`/runs/${run.id}`}>
                    查看完整 Trace
                    <ArrowRight size={15} />
                  </Link>
                  <button
                    className="button button--secondary"
                    onClick={() => execute()}
                    type="button"
                  >
                    <RotateCcw size={15} />
                    再次运行
                  </button>
                </div>
              </article>
              <article className="panel trace-preview">
                <div className="panel-heading">
                  <div>
                    <h2>执行链路</h2>
                    <p>事件按执行顺序记录</p>
                  </div>
                  <span className="panel-chip">{run.events?.length} EVENTS</span>
                </div>
                <TraceTimeline events={run.events} compact />
              </article>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
