"use client";

import {
  ArrowLeft,
  BookOpen,
  Box,
  Check,
  ChevronRight,
  Code2,
  GitBranch,
  Play,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  Wrench
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AgentMark } from "@/components/AgentMark";
import { LoadingState } from "@/components/LoadingState";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import {
  formatCost,
  formatDate,
  formatDuration,
  formatIntent
} from "@/lib/format";
import type {
  AgentDetail,
  AgentVersion,
  EvalDataset,
  ReleaseCheck
} from "@/lib/types";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "versions" | "tools">("overview");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  const [allTools, setAllTools] = useState<
    Awaited<ReturnType<typeof api.tools>>
  >([]);
  const [role, setRole] = useState("viewer");
  const [bindingVersionId, setBindingVersionId] = useState("");
  const [toolSelection, setToolSelection] = useState<string[]>([]);
  const [toolsSaving, setToolsSaving] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<AgentVersion | null>(
    null
  );
  const [releaseSaving, setReleaseSaving] = useState(false);
  const [releaseError, setReleaseError] = useState("");
  const [releaseResult, setReleaseResult] = useState<{
    passed: boolean;
    accuracy: number;
    p95LatencyMs: number;
    avgCostCents: number;
    reason: string;
  } | null>(null);
  const [releaseForm, setReleaseForm] = useState({
    dataset_id: "",
    min_accuracy: 0.9,
    max_p95_latency_ms: 2000,
    max_avg_cost_cents: 2
  });
  const [versionForm, setVersionForm] = useState({
    system_prompt: "",
    budget_cents: 20,
    max_steps: 8
  });

  const load = async () => {
    setLoading(true);
    try {
      const [value, auth, tools] = await Promise.all([
        api.agent(id),
        api.me(),
        api.tools()
      ]);
      setAgent(value);
      setRole(auth.activeTenant.role);
      setAllTools(tools);
      setVersionForm({
        system_prompt:
          value.latestDraft?.systemPrompt ||
          value.latestVersion?.systemPrompt ||
          "",
        budget_cents:
          value.latestDraft?.budgetCents ||
          value.latestVersion?.budgetCents ||
          20,
        max_steps:
          value.latestDraft?.maxSteps ||
          value.latestVersion?.maxSteps ||
          8
      });
      const targetVersion =
        value.latestDraft ||
        value.latestVersion ||
        value.versions[0] ||
        null;
      if (targetVersion) {
        setBindingVersionId(targetVersion.id);
        setToolSelection(value.toolBindings[targetVersion.id] || []);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    api
      .datasets()
      .then((items) => {
        setDatasets(items);
        if (items[0]) {
          setReleaseForm((current) => ({
            ...current,
            dataset_id: current.dataset_id || items[0].id
          }));
        }
      })
      .catch(() => undefined);
  }, []);

  const createVersion = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.createVersion(id, {
        ...versionForm,
        model:
          agent?.latestDraft?.model ||
          agent?.latestVersion?.model ||
          "demo-deterministic",
        config: { temperature: 0.1, trace: true, fallback: "manual-review" }
      });
      setModalOpen(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runReleaseCheck = async (event: FormEvent) => {
    event.preventDefault();
    if (!releaseTarget) return;
    setReleaseSaving(true);
    setReleaseError("");
    setReleaseResult(null);
    try {
      const result = await api.releaseCheck(
        id,
        releaseTarget.id,
        releaseForm
      );
      setReleaseResult(result);
      load();
    } catch (err) {
      setReleaseError((err as Error).message);
    } finally {
      setReleaseSaving(false);
    }
  };

  const selectBindingVersion = (versionId: string) => {
    setBindingVersionId(versionId);
    setToolSelection(agent?.toolBindings[versionId] || []);
  };

  const toggleTool = (toolId: string) => {
    setToolSelection((current) =>
      current.includes(toolId)
        ? current.filter((id) => id !== toolId)
        : [...current, toolId]
    );
  };

  const saveToolBindings = async () => {
    if (!bindingVersionId) return;
    setToolsSaving(true);
    setError("");
    try {
      await api.setVersionTools(id, bindingVersionId, toolSelection);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setToolsSaving(false);
    }
  };

  if (loading) return <LoadingState label="正在加载 Agent" />;
  if (error || !agent) {
    return <div className="error-panel">{error || "Agent 不存在"}</div>;
  }

  const runtimeVersion = agent.latestVersion || agent.latestDraft;
  const releaseChecks = agent.releaseChecks || [];
  const bindingVersion = agent.versions.find(
    (version) => version.id === bindingVersionId
  );
  const canEdit = ["owner", "member"].includes(role);

  return (
    <>
      <Link className="back-link" href="/agents">
        <ArrowLeft size={15} />
        Agent 注册表
      </Link>
      <header className="detail-header">
        <div className="detail-identity">
          <AgentMark icon={agent.icon} color={agent.color} size="lg" />
          <div>
            <div className="detail-title-row">
              <h1>{agent.name}</h1>
              <StatusBadge status={agent.status} />
            </div>
            <p>{agent.description}</p>
            <div className="detail-meta">
              <span>
                <GitBranch size={14} />
                {agent.latestVersion
                  ? `当前发布 v${agent.latestVersion.version}`
                  : agent.latestDraft
                    ? `草稿版本 v${agent.latestDraft.version}`
                    : "尚无版本"}
              </span>
              <span>
                <SlidersHorizontal size={14} />
                {runtimeVersion?.model}
              </span>
              <span>最后更新 {formatDate(agent.updatedAt)}</span>
            </div>
          </div>
        </div>
        <div className="page-actions">
          {canEdit ? (
            <button
              className="button button--secondary"
              onClick={() => setModalOpen(true)}
              type="button"
            >
              <Plus size={16} />
              创建版本
            </button>
          ) : null}
          {agent.latestVersion ? (
            <Link
              className="button button--primary"
              href={`/playground?agent=${agent.id}`}
            >
              <Play size={16} />
              运行 Agent
            </Link>
          ) : (
            <button
              className="button button--primary"
              disabled
              title="通过发布门禁后才能运行"
              type="button"
            >
              <Play size={16} />
              等待发布
            </button>
          )}
        </div>
      </header>

      <div className="detail-tabs">
        {[
          ["overview", "概览"],
          ["versions", `版本 (${agent.versions.length})`],
          ["tools", `工具 (${agent.tools.length})`]
        ].map(([value, label]) => (
          <button
            className={tab === value ? "detail-tab active" : "detail-tab"}
            key={value}
            onClick={() => setTab(value as typeof tab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="detail-grid">
          <div className="detail-column-main">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>运行表现</h2>
                  <p>最近一次发布版本的活动</p>
                </div>
                <span className="panel-chip">LIVE</span>
              </div>
              <div className="metric-strip">
                <div>
                  <span>累计运行</span>
                  <strong>{agent.runCount}</strong>
                </div>
                <div>
                  <span>版本数</span>
                  <strong>{agent.versionCount}</strong>
                </div>
                <div>
                  <span>最高步数</span>
                  <strong>{runtimeVersion?.maxSteps}</strong>
                </div>
                <div>
                  <span>单次预算</span>
                  <strong>${((runtimeVersion?.budgetCents || 0) / 100).toFixed(2)}</strong>
                </div>
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>系统提示词</h2>
                  <p>版本 v{runtimeVersion?.version}</p>
                </div>
                <Code2 size={18} className="panel-heading-icon" />
              </div>
              <pre className="prompt-block">
                {runtimeVersion?.systemPrompt || "还没有提示词。"}
              </pre>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>最近运行</h2>
                  <p>点击查看完整执行链路</p>
                </div>
                <Link className="text-link" href={`/runs?agent=${agent.id}`}>
                  查看全部 <ChevronRight size={14} />
                </Link>
              </div>
              <div className="compact-run-list">
                {agent.recentRuns.map((run) => (
                  <Link className="compact-run" href={`/runs/${run.id}`} key={run.id}>
                    <span className="compact-run-status">
                      <StatusBadge status={run.status} />
                    </span>
                    <span className="compact-run-copy">
                      <strong>{run.input}</strong>
                      <small>
                        {formatIntent(run.intent)} · {formatDate(run.startedAt)}
                      </small>
                    </span>
                    <span className="mono">{formatDuration(run.latencyMs)}</span>
                    <ChevronRight size={15} />
                  </Link>
                ))}
              </div>
            </article>
          </div>

          <aside className="detail-column-side">
            <article className="panel config-panel">
              <div className="panel-heading">
                <div>
                  <h2>运行时配置</h2>
                  <p>当前发布版本</p>
                </div>
              </div>
              <div className="config-list">
                <div>
                  <span>模型</span>
                  <code>{runtimeVersion?.model}</code>
                </div>
                <div>
                  <span>状态存储</span>
                  <code>SQLite checkpoint</code>
                </div>
                <div>
                  <span>检索策略</span>
                  <code>{String(runtimeVersion?.config.retrieval || "lexical")}</code>
                </div>
                <div>
                  <span>失败策略</span>
                  <code>{String(runtimeVersion?.config.fallback || "manual-review")}</code>
                </div>
              </div>
            </article>
            <article className="panel safety-panel">
              <div className="safety-icon">
                <ShieldCheck size={19} />
              </div>
              <h3>写操作保护已开启</h3>
              <p>
                所有退款工具调用都会生成审批事件。审批通过后从持久化检查点继续运行。
              </p>
              <div className="safety-row">
                <Check size={14} />
                人工审批
              </div>
              <div className="safety-row">
                <Check size={14} />
                幂等与重试
              </div>
              <div className="safety-row">
                <Check size={14} />
                完整事件追踪
              </div>
            </article>
          </aside>
        </div>
      ) : null}

      {tab === "versions" ? (
        <div className="version-list">
          {agent.versions.map((version, index) => (
            <article className="panel version-card" key={version.id}>
              <div className="version-marker">
                <span>
                  {version.status === "published" ? (
                    <Check size={16} />
                  ) : (
                    <Box size={16} />
                  )}
                </span>
                {index < agent.versions.length - 1 ? <i /> : null}
              </div>
              <div className="version-body">
                <div className="version-heading">
                  <div>
                    <h3>v{version.version}</h3>
                    <StatusBadge status={version.status} />
                  </div>
                  <span className="muted">{formatDate(version.createdAt)}</span>
                </div>
                <p>{version.systemPrompt}</p>
                <div className="version-foot">
                  <span>{version.model}</span>
                  <span>{version.maxSteps} 最大步数</span>
                  <span>预算 ${(version.budgetCents / 100).toFixed(2)}</span>
                  {version.status === "draft" && canEdit ? (
                    <button
                      className="button button--primary button--small"
                      onClick={() => {
                        setReleaseTarget(version);
                        setReleaseResult(null);
                        setReleaseError("");
                      }}
                      type="button"
                    >
                      <Sparkles size={13} />
                      评测并发布
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
          {releaseChecks.length ? (
            <article className="panel release-history">
              <div className="panel-heading">
                <div>
                  <h2>发布门禁记录</h2>
                  <p>最近 20 次版本评估与放行决策</p>
                </div>
                <ShieldCheck size={18} className="panel-heading-icon" />
              </div>
              <div className="release-history-list">
                {releaseChecks.map((check: ReleaseCheck) => (
                  <div className="release-history-row" key={check.id}>
                    <span
                      className={
                        check.passed
                          ? "result-check result-check--pass"
                          : "result-check result-check--fail"
                      }
                    >
                      {check.passed ? (
                        <Check size={14} />
                      ) : (
                        <X size={14} />
                      )}
                    </span>
                    <span>
                      <strong>
                        {check.passed ? "允许发布" : "阻止发布"}
                      </strong>
                      <small>{check.reason}</small>
                    </span>
                    <span>
                      准确率 {Math.round(check.actualAccuracy * 100)}%
                    </span>
                    <span>{check.actualP95LatencyMs}ms</span>
                    <span>
                      {formatCost(check.actualAvgCostCents)}
                    </span>
                    <small>{formatDate(check.createdAt)}</small>
                  </div>
                ))}
              </div>
            </article>
          ) : null}
        </div>
      ) : null}

      {tab === "tools" ? (
        <div className="tool-binding-area">
          <article className="panel tool-binding-toolbar">
            <div>
              <h2>版本工具权限</h2>
              <p>
                Draft 可以绑定内置或 MCP 工具；发布后绑定会随版本冻结。
              </p>
            </div>
            <div className="tool-binding-actions">
              <label>
                <span>版本</span>
                <select
                  onChange={(event) =>
                    selectBindingVersion(event.target.value)
                  }
                  value={bindingVersionId}
                >
                  {agent.versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version} · {version.status}
                    </option>
                  ))}
                </select>
              </label>
              {bindingVersion ? (
                <StatusBadge status={bindingVersion.status} />
              ) : null}
              {canEdit && bindingVersion?.status === "draft" ? (
                <button
                  className="button button--primary"
                  disabled={toolsSaving}
                  onClick={saveToolBindings}
                  type="button"
                >
                  {toolsSaving ? (
                    <span className="spinner spinner--light" />
                  ) : (
                    <Check size={15} />
                  )}
                  {toolsSaving ? "保存中…" : "保存工具绑定"}
                </button>
              ) : null}
            </div>
          </article>

          {!canEdit || bindingVersion?.status !== "draft" ? (
            <div className="inline-alert">
              当前版本不可编辑。请创建或选择一个 Draft 版本后再修改工具绑定。
            </div>
          ) : null}

          <div className="tool-detail-grid">
            {allTools.map((tool) => {
              const selected = toolSelection.includes(tool.id);
              return (
                <label
                  className={
                    selected
                      ? "panel tool-detail-card tool-binding-card selected"
                      : "panel tool-detail-card tool-binding-card"
                  }
                  key={tool.id}
                >
                  <div className="tool-detail-top">
                    <span className="tool-glyph">
                      <Wrench size={18} />
                    </span>
                    <input
                      checked={selected}
                      disabled={
                        !canEdit || bindingVersion?.status !== "draft"
                      }
                      onChange={() => toggleTool(tool.id)}
                      type="checkbox"
                    />
                  </div>
                  <div className="tool-binding-tags">
                    {tool.source === "mcp" ? (
                      <span className="mcp-source-chip">
                        MCP · {tool.remoteName}
                      </span>
                    ) : (
                      <span className="builtin-source-chip">内置工具</span>
                    )}
                    {tool.requiresApproval ? (
                      <span className="guard-chip">
                        <ShieldCheck size={12} /> 审批
                      </span>
                    ) : (
                      <span className="safe-chip">只读</span>
                    )}
                  </div>
                  <h3>{tool.name}</h3>
                  <code>{tool.slug}()</code>
                  <p>{tool.description}</p>
                  <div className="schema-preview">
                    {Object.keys(tool.schema || {}).length
                      ? "JSON Schema 已配置"
                      : "无参数"}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <span className="modal-icon">
                  <GitBranch size={18} />
                </span>
                <h2>创建 Draft 版本</h2>
                <p>保存后不会直接影响线上运行，需通过评测门禁才能发布。</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setModalOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <form className="form-stack" onSubmit={createVersion}>
              <label>
                <span>系统提示词</span>
                <textarea
                  onChange={(event) =>
                    setVersionForm({
                      ...versionForm,
                      system_prompt: event.target.value
                    })
                  }
                  rows={7}
                  value={versionForm.system_prompt}
                />
              </label>
              <div className="form-row">
                <label>
                  <span>最大步数</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      setVersionForm({
                        ...versionForm,
                        max_steps: Number(event.target.value)
                      })
                    }
                    type="number"
                    value={versionForm.max_steps}
                  />
                </label>
                <label>
                  <span>预算（美分）</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      setVersionForm({
                        ...versionForm,
                        budget_cents: Number(event.target.value)
                      })
                    }
                    type="number"
                    value={versionForm.budget_cents}
                  />
                </label>
              </div>
              <div className="modal-footer">
                <button
                  className="button button--secondary"
                  onClick={() => setModalOpen(false)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="button button--primary"
                  disabled={saving}
                  type="submit"
                >
                  {saving ? "创建中…" : "创建 Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {releaseTarget ? (
        <div className="modal-backdrop">
          <div className="modal-card release-modal" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <span className="modal-icon">
                  <ShieldCheck size={18} />
                </span>
                <h2>发布门禁 · v{releaseTarget.version}</h2>
                <p>
                  运行回归集；满足全部指标后才会替换当前线上版本。
                </p>
              </div>
              <button
                className="icon-button"
                onClick={() => setReleaseTarget(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <form className="form-stack" onSubmit={runReleaseCheck}>
              <label>
                <span>回归测试集</span>
                <select
                  onChange={(event) =>
                    setReleaseForm({
                      ...releaseForm,
                      dataset_id: event.target.value
                    })
                  }
                  value={releaseForm.dataset_id}
                >
                  {datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name} · {dataset.caseCount} cases
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label>
                  <span>最低准确率</span>
                  <div className="input-suffix">
                    <input
                      max={100}
                      min={0}
                      onChange={(event) =>
                        setReleaseForm({
                          ...releaseForm,
                          min_accuracy: Number(event.target.value) / 100
                        })
                      }
                      type="number"
                      value={Math.round(releaseForm.min_accuracy * 100)}
                    />
                    <span>%</span>
                  </div>
                </label>
                <label>
                  <span>最高 P95 延迟</span>
                  <div className="input-suffix">
                    <input
                      min={1}
                      onChange={(event) =>
                        setReleaseForm({
                          ...releaseForm,
                          max_p95_latency_ms: Number(event.target.value)
                        })
                      }
                      type="number"
                      value={releaseForm.max_p95_latency_ms}
                    />
                    <span>ms</span>
                  </div>
                </label>
              </div>
              <label>
                <span>最高平均成本</span>
                <div className="input-suffix">
                  <input
                    min={0}
                    onChange={(event) =>
                      setReleaseForm({
                        ...releaseForm,
                        max_avg_cost_cents: Number(event.target.value)
                      })
                    }
                    step="0.001"
                    type="number"
                    value={releaseForm.max_avg_cost_cents}
                  />
                  <span>美分 / 次</span>
                </div>
              </label>

              {releaseError ? (
                <div className="inline-alert inline-alert--danger">
                  {releaseError}
                </div>
              ) : null}
              {releaseResult ? (
                <div
                  className={
                    releaseResult.passed
                      ? "release-result release-result--passed"
                      : "release-result release-result--failed"
                  }
                >
                  <strong>
                    {releaseResult.passed
                      ? "发布门禁通过，新版本已上线"
                      : "发布被阻止，版本保持 Draft"}
                  </strong>
                  <p>{releaseResult.reason}</p>
                  <div>
                    <span>
                      准确率 {Math.round(releaseResult.accuracy * 100)}%
                    </span>
                    <span>{releaseResult.p95LatencyMs}ms</span>
                    <span>{formatCost(releaseResult.avgCostCents)}</span>
                  </div>
                </div>
              ) : null}

              <div className="modal-footer">
                <button
                  className="button button--secondary"
                  onClick={() => setReleaseTarget(null)}
                  type="button"
                >
                  {releaseResult?.passed ? "关闭" : "取消"}
                </button>
                {!releaseResult?.passed ? (
                  <button
                    className="button button--primary"
                    disabled={releaseSaving || !releaseForm.dataset_id}
                    type="submit"
                  >
                    {releaseSaving ? (
                      <>
                        <span className="spinner spinner--light" />
                        正在执行回归
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={15} />
                        执行门禁
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
