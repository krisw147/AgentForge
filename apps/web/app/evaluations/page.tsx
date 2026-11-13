"use client";

import {
  ArrowRight,
  Beaker,
  Check,
  CheckCircle2,
  FlaskConical,
  Layers3,
  Play,
  TrendingUp,
  X
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AgentMark } from "@/components/AgentMark";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import {
  formatCost,
  formatDate,
  formatDuration,
  formatIntent,
  formatOutcome
} from "@/lib/format";
import type {
  AgentDetail,
  AgentSummary,
  EvalDataset,
  EvalRun
} from "@/lib/types";

export default function EvaluationsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedDataset, setSelectedDataset] = useState("");
  const [agentDetail, setAgentDetail] = useState<AgentDetail | null>(null);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [agentItems, datasetItems, runItems] = await Promise.all([
        api.agents(),
        api.datasets(),
        api.evalRuns()
      ]);
      setAgents(agentItems);
      setDatasets(datasetItems);
      setRuns(runItems);
      setSelectedAgent((current) => current || agentItems[0]?.id || "");
      setSelectedDataset((current) => current || datasetItems[0]?.id || "");
      setSelectedRunId((current) => current || runItems[0]?.id || "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedAgent) return;
    api.agent(selectedAgent).then((detail) => {
      setAgentDetail(detail);
      setSelectedVersion(detail.latestVersion?.id || "");
    });
  }, [selectedAgent]);

  const currentRun = useMemo(
    () => runs.find((item) => item.id === selectedRunId) || runs[0],
    [runs, selectedRunId]
  );
  const latest = runs[0];
  const previous = runs[1];
  const delta =
    latest && previous
      ? Math.round((latest.accuracy - previous.accuracy) * 100)
      : 0;

  const execute = async () => {
    if (!selectedAgent || !selectedDataset) return;
    setRunning(true);
    setError("");
    try {
      const created = await api.runEvaluation({
        agent_id: selectedAgent,
        dataset_id: selectedDataset,
        version_id: selectedVersion || undefined
      });
      await load();
      setSelectedRunId(created.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <LoadingState label="正在加载评测中心" />;

  return (
    <>
      <PageHeader
        eyebrow="QUALITY LAB"
        title="评测中心"
        description="用固定回归集比较 Agent 版本。质量、延迟和成本需要一起被衡量。"
        actions={
          <button
            className="button button--primary"
            disabled={running}
            onClick={execute}
            type="button"
          >
            {running ? (
              <>
                <span className="spinner spinner--light" />
                正在运行回归
              </>
            ) : (
              <>
                <Play size={16} />
                运行评测
              </>
            )}
          </button>
        }
      />

      {error ? (
        <div className="inline-alert inline-alert--danger">{error}</div>
      ) : null}

      <section className="eval-top-grid">
        <article className="panel eval-hero-card">
          <div className="eval-hero-copy">
            <span className="panel-chip">LATEST REGRESSION</span>
            <h2>退款流程回归集</h2>
            <p>
              覆盖大额审批、订单查询、政策问答和工单创建，共{" "}
              {datasets[0]?.caseCount || 0} 条测试用例。
            </p>
            <div className="eval-hero-meta">
              <span>
                <Layers3 size={14} />
                {datasets[0]?.caseCount} cases
              </span>
              <span>
                <TrendingUp size={14} />
                对比 v{previous?.version || "1.0"}
              </span>
            </div>
          </div>
          <div className="eval-hero-score">
            <strong>{Math.round((latest?.accuracy || 0) * 100)}%</strong>
            <span>准确率</span>
            <em className={delta >= 0 ? "positive" : "negative"}>
              {delta >= 0 ? "+" : ""}
              {delta}%
            </em>
          </div>
        </article>

        <article className="panel eval-controls-card">
          <div className="panel-heading panel-heading--compact">
            <div>
              <h2>新评测运行</h2>
              <p>选择 Agent、版本与测试集</p>
            </div>
          </div>
          <label className="field-label">
            <span>Agent</span>
            <select
              onChange={(event) => setSelectedAgent(event.target.value)}
              value={selectedAgent}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label className="field-label">
              <span>版本</span>
              <select
                onChange={(event) => setSelectedVersion(event.target.value)}
                value={selectedVersion}
              >
                {agentDetail?.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>测试集</span>
              <select
                onChange={(event) => setSelectedDataset(event.target.value)}
                value={selectedDataset}
              >
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="eval-control-foot">
            <span>
              <FlaskConical size={14} />
              将创建 {datasets[0]?.caseCount || 0} 次真实运行
            </span>
            <button
              className="button button--secondary button--small"
              disabled={running}
              onClick={execute}
              type="button"
            >
              开始 <ArrowRight size={14} />
            </button>
          </div>
        </article>
      </section>

      <section className="eval-metrics-grid">
        <div className="eval-metric">
          <span className="eval-metric-icon">
            <CheckCircle2 size={17} />
          </span>
          <div>
            <span>通过用例</span>
            <strong>
              {latest?.passedCases || 0}/{latest?.totalCases || 0}
            </strong>
          </div>
        </div>
        <div className="eval-metric">
          <span className="eval-metric-icon">
            <Beaker size={17} />
          </span>
          <div>
            <span>P95 延迟</span>
            <strong>{formatDuration(latest?.p95LatencyMs)}</strong>
          </div>
        </div>
        <div className="eval-metric">
          <span className="eval-metric-icon">
            <FlaskConical size={17} />
          </span>
          <div>
            <span>平均成本</span>
            <strong>{formatCost(latest?.avgCostCents)}</strong>
          </div>
        </div>
        <div className="eval-metric">
          <span className="eval-metric-icon">
            <TrendingUp size={17} />
          </span>
          <div>
            <span>最近评测</span>
            <strong>{formatDate(latest?.createdAt)}</strong>
          </div>
        </div>
      </section>

      <section className="eval-content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>版本对比</h2>
              <p>选择一次评测查看用例结果</p>
            </div>
            <select
              className="compact-select"
              onChange={(event) => setSelectedRunId(event.target.value)}
              value={selectedRunId}
            >
              {runs.map((item) => (
                <option key={item.id} value={item.id}>
                  v{item.version} · {formatDate(item.createdAt)}
                </option>
              ))}
            </select>
          </div>
          <div className="version-compare-list">
            {runs.slice(0, 4).map((item) => (
              <button
                className={
                  item.id === selectedRunId
                    ? "version-compare-row active"
                    : "version-compare-row"
                }
                key={item.id}
                onClick={() => setSelectedRunId(item.id)}
                type="button"
              >
                <span className="version-name">v{item.version}</span>
                <span className="version-bar-track">
                  <i style={{ width: `${item.accuracy * 100}%` }} />
                </span>
                <strong>{Math.round(item.accuracy * 100)}%</strong>
                <span>{item.passedCases}/{item.totalCases}</span>
              </button>
            ))}
          </div>
          <div className="eval-dataset-note">
            <span className="dataset-icon">
              <Layers3 size={17} />
            </span>
            <div>
              <strong>{currentRun?.datasetName}</strong>
              <p>每次发布前在同一测试集上执行回归，避免提示词改动造成退化。</p>
            </div>
          </div>
        </article>

        <article className="panel eval-results-card">
          <div className="panel-heading">
            <div>
              <h2>用例结果</h2>
              <p>{currentRun?.version} · {currentRun?.passedCases}/{currentRun?.totalCases} 通过</p>
            </div>
            <StatusBadge status={currentRun?.status || "completed"} />
          </div>
          <div className="eval-result-list">
            {currentRun?.results.map((result) => (
              <Link
                className="eval-result-row"
                href={result.runId ? `/runs/${result.runId}` : "#"}
                key={result.id}
              >
                <span
                  className={
                    result.passed
                      ? "result-check result-check--pass"
                      : "result-check result-check--fail"
                  }
                >
                  {result.passed ? <Check size={14} /> : <X size={14} />}
                </span>
                <span className="eval-result-copy">
                  <strong>{result.caseName}</strong>
                  <small>{result.input}</small>
                </span>
                <span className="eval-result-expect">
                  <span>{formatIntent(result.actualIntent)}</span>
                  <small>{formatOutcome(result.actualOutcome)}</small>
                </span>
                <span className="mono">{formatDuration(result.latencyMs)}</span>
              </Link>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}

