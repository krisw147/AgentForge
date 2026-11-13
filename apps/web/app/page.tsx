"use client";

import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FlaskConical,
  Plus,
  ShieldCheck,
  Sparkles,
  TrendingUp
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentMark } from "@/components/AgentMark";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import {
  formatCost,
  formatDate,
  formatDuration,
  formatIntent
} from "@/lib/format";
import type { DashboardData } from "@/lib/types";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .dashboard()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="error-panel">
        <Activity size={22} />
        <div>
          <strong>无法连接 AgentForge API</strong>
          <p>{error}。请确认本地 API 已在 8000 端口启动。</p>
        </div>
      </div>
    );
  }
  if (!data) return <LoadingState label="正在加载控制台" />;

  const stats = data.stats;
  const maxRuns = Math.max(...data.trend.map((item) => item.runs), 1);
  const latestEval = data.evaluations[0];
  const previousEval = data.evaluations[1];
  const canApprove = ["owner", "approver"].includes(data.user.role);
  const accuracyDelta =
    latestEval && previousEval
      ? Math.round((latestEval.accuracy - previousEval.accuracy) * 100)
      : 0;

  return (
    <>
      <PageHeader
        eyebrow="CONTROL PLANE"
        title={`早上好，${data.user.name}`}
        description="这里是你所有 Agent 的运行、风险与质量视图。"
        actions={
          <>
            <Link className="button button--secondary" href="/playground">
              <FlaskConical size={16} />
              打开 Playground
            </Link>
            <Link className="button button--primary" href="/agents">
              <Plus size={16} />
              新建 Agent
            </Link>
          </>
        }
      />

      <section className="hero-band">
        <div className="hero-band-copy">
          <span className="hero-icon">
            <Sparkles size={18} />
          </span>
          <div>
            <strong>平台运行正常，所有检查点已同步</strong>
            <p>
              当前工作区已处理 {stats.totalRuns} 次运行，审批与工具故障均可完整回放。
            </p>
          </div>
        </div>
        <div className="hero-health">
          <span className="health-dot" />
          <span>运行引擎健康</span>
          <small>P95 可用性 99.98%</small>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card stat-card--violet">
          <div className="stat-icon">
            <Activity size={18} />
          </div>
          <div className="stat-label">总运行次数</div>
          <div className="stat-value">{stats.totalRuns.toLocaleString()}</div>
          <div className="stat-foot">
            <TrendingUp size={13} />
            <span>已完成 {stats.completedRuns} 次</span>
          </div>
        </article>
        <article className="stat-card stat-card--green">
          <div className="stat-icon">
            <CheckCircle2 size={18} />
          </div>
          <div className="stat-label">任务成功率</div>
          <div className="stat-value">{(stats.successRate * 100).toFixed(1)}%</div>
          <div className="stat-foot">
            <span className="mini-positive">稳定</span>
            <span>按已完成运行计算</span>
          </div>
        </article>
        <article className="stat-card stat-card--amber">
          <div className="stat-icon">
            <ShieldCheck size={18} />
          </div>
          <div className="stat-label">待处理审批</div>
          <div className="stat-value">{stats.pendingApprovals}</div>
          <div className="stat-foot">
            <span className="mini-warning">需要关注</span>
            <span>敏感操作已暂停</span>
          </div>
        </article>
        <article className="stat-card stat-card--blue">
          <div className="stat-icon">
            <Clock3 size={18} />
          </div>
          <div className="stat-label">平均响应时间</div>
          <div className="stat-value">{formatDuration(stats.avgLatencyMs)}</div>
          <div className="stat-foot">
            <CircleDollarSign size={13} />
            <span>{formatCost(stats.totalCostCents)} 累计模型成本</span>
          </div>
        </article>
      </section>

      <section className="dashboard-main-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>运行趋势</h2>
              <p>最近 7 天的 Agent 执行次数</p>
            </div>
            <span className="panel-chip">7 DAYS</span>
          </div>
          <div className="chart-wrap">
            <div className="chart-grid-lines">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="bar-chart">
              {data.trend.map((item) => (
                <div className="bar-column" key={item.date}>
                  <div className="bar-value">{item.runs}</div>
                  <div
                    className="bar-fill"
                    style={{
                      height: `${Math.max(7, (item.runs / maxRuns) * 100)}%`
                    }}
                  />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-dot legend-dot--violet" />
              全部运行
            </span>
            <span className="chart-summary">
              日均 {Math.round(stats.totalRuns / 7)} 次
            </span>
          </div>
        </article>

        <article className="panel evaluation-spotlight">
          <div className="panel-heading">
            <div>
              <h2>质量评测</h2>
              <p>最新版本回归结果</p>
            </div>
            <Link className="text-link" href="/evaluations">
              查看全部 <ArrowRight size={14} />
            </Link>
          </div>
          <div className="eval-score-row">
            <div className="score-ring">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="50" className="score-ring-track" />
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  className="score-ring-value"
                  style={{
                    strokeDasharray: `${(latestEval?.accuracy || 0) * 314} 314`
                  }}
                />
              </svg>
              <div>
                <strong>{Math.round((latestEval?.accuracy || 0) * 100)}%</strong>
                <span>准确率</span>
              </div>
            </div>
            <div className="eval-metrics">
              <div>
                <span>版本提升</span>
                <strong className={accuracyDelta >= 0 ? "positive" : "negative"}>
                  {accuracyDelta >= 0 ? "+" : ""}
                  {accuracyDelta}%
                </strong>
              </div>
              <div>
                <span>测试用例</span>
                <strong>
                  {latestEval?.passedCases || 0}/{latestEval?.totalCases || 0}
                </strong>
              </div>
              <div>
                <span>P95 延迟</span>
                <strong>{formatDuration(latestEval?.p95LatencyMs)}</strong>
              </div>
            </div>
          </div>
          <div className="eval-compare-bars">
            <div>
              <span>v1.0</span>
              <div className="compare-track">
                <i style={{ width: `${(previousEval?.accuracy || 0) * 100}%` }} />
              </div>
              <b>{Math.round((previousEval?.accuracy || 0) * 100)}%</b>
            </div>
            <div>
              <span>v1.1</span>
              <div className="compare-track compare-track--current">
                <i style={{ width: `${(latestEval?.accuracy || 0) * 100}%` }} />
              </div>
              <b>{Math.round((latestEval?.accuracy || 0) * 100)}%</b>
            </div>
          </div>
        </article>
      </section>

      <section
        className={
          canApprove
            ? "dashboard-lower-grid"
            : "dashboard-lower-grid dashboard-lower-grid--single"
        }
      >
        <article className="panel recent-runs-panel">
          <div className="panel-heading">
            <div>
              <h2>最近运行</h2>
              <p>实时追踪每次 Agent 决策</p>
            </div>
            <Link className="text-link" href="/runs">
              全部运行 <ArrowRight size={14} />
            </Link>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent / 请求</th>
                  <th>意图</th>
                  <th>状态</th>
                  <th>耗时</th>
                  <th>成本</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link className="agent-cell" href={`/runs/${run.id}`}>
                        <AgentMark
                          icon={run.agent?.icon}
                          color={run.agent?.color}
                          size="sm"
                        />
                        <span>
                          <strong>{run.agent?.name || "Unknown Agent"}</strong>
                          <small>{run.input}</small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="intent-chip">{formatIntent(run.intent)}</span>
                    </td>
                    <td>
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="mono">{formatDuration(run.latencyMs)}</td>
                    <td className="mono">{formatCost(run.costCents)}</td>
                    <td className="muted">{formatDate(run.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        {canApprove ? (
        <article className="panel approval-panel">
          <div className="panel-heading">
            <div>
              <h2>审批队列</h2>
              <p>等待人工确认的敏感操作</p>
            </div>
            <Link className="text-link" href="/approvals">
              管理 <ArrowRight size={14} />
            </Link>
          </div>
          <div className="approval-list">
            {data.approvalQueue.length ? (
              data.approvalQueue.map(({ approval, run }) => (
                <Link
                  className="approval-item"
                  href={`/runs/${run.id}`}
                  key={approval.id}
                >
                  <span className="approval-icon">
                    <ShieldCheck size={17} />
                  </span>
                  <span className="approval-copy">
                    <strong>退款操作待审批</strong>
                    <span>{run.input}</span>
                    <small>{formatDate(approval.requestedAt)}</small>
                  </span>
                  <ArrowRight size={15} />
                </Link>
              ))
            ) : (
              <div className="approval-empty">
                <CheckCircle2 size={20} />
                当前没有待处理审批
              </div>
            )}
          </div>
        </article>
        ) : null}
      </section>
    </>
  );
}
