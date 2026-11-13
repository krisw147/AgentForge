"use client";

import {
  Activity,
  ChevronRight,
  Filter,
  RefreshCw,
  Search
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AgentMark } from "@/components/AgentMark";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import {
  formatCost,
  formatDate,
  formatDuration,
  formatIntent,
  shortId
} from "@/lib/format";
import type { Run } from "@/lib/types";

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("");

  const load = () => {
    setLoading(true);
    api
      .runs()
      .then(setRuns)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setAgentFilter(
      new URLSearchParams(window.location.search).get("agent") || ""
    );
    load();
  }, []);

  const filtered = useMemo(
    () =>
      runs.filter((run) => {
        const matchesStatus = status === "all" || run.status === status;
        const matchesAgent = !agentFilter || run.agent?.id === agentFilter;
        const haystack =
          `${run.id} ${run.input} ${run.output} ${run.agent?.name}`.toLowerCase();
        return (
          matchesStatus &&
          matchesAgent &&
          (!query || haystack.includes(query.toLowerCase()))
        );
      }),
    [agentFilter, query, runs, status]
  );

  return (
    <>
      <PageHeader
        eyebrow="OBSERVABILITY"
        title="运行记录"
        description="搜索、筛选并回放每一次 Agent 执行，定位模型、工具与审批问题。"
        actions={
          <button className="button button--secondary" onClick={load} type="button">
            <RefreshCw size={15} />
            刷新
          </button>
        }
      />

      {error ? (
        <div className="inline-alert inline-alert--danger">{error}</div>
      ) : null}

      <div className="run-summary-strip">
        <div>
          <span>全部运行</span>
          <strong>{runs.length}</strong>
        </div>
        <div>
          <span>已完成</span>
          <strong>{runs.filter((run) => run.status === "completed").length}</strong>
        </div>
        <div>
          <span>等待审批</span>
          <strong>
            {runs.filter((run) => run.status === "waiting_approval").length}
          </strong>
        </div>
        <div>
          <span>失败 / 需补充</span>
          <strong>
            {
              runs.filter((run) =>
                ["failed", "needs_input"].includes(run.status)
              ).length
            }
          </strong>
        </div>
      </div>

      <article className="panel">
        <div className="run-toolbar">
          <div className="filter-tabs">
            {[
              ["all", "全部"],
              ["completed", "已完成"],
              ["waiting_approval", "待审批"],
              ["failed", "失败"],
              ["needs_input", "需补充"]
            ].map(([value, label]) => (
              <button
                className={status === value ? "filter-tab active" : "filter-tab"}
                key={value}
                onClick={() => setStatus(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="run-toolbar-right">
            {agentFilter ? (
              <button
                className="active-filter"
                onClick={() => setAgentFilter("")}
                type="button"
              >
                <Filter size={13} />
                已筛选 Agent
                <span>×</span>
              </button>
            ) : null}
            <label className="search-field">
              <Search size={16} />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索输入、输出或运行 ID"
                value={query}
              />
            </label>
          </div>
        </div>

        {loading ? (
          <LoadingState label="正在加载运行记录" />
        ) : filtered.length ? (
          <div className="table-wrap">
            <table className="data-table runs-table">
              <thead>
                <tr>
                  <th>运行</th>
                  <th>Agent</th>
                  <th>意图 / 版本</th>
                  <th>状态</th>
                  <th>耗时</th>
                  <th>成本</th>
                  <th>开始时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link className="run-id-link" href={`/runs/${run.id}`}>
                        <Activity size={14} />
                        {shortId(run.id)}
                      </Link>
                      <div className="run-input-preview">{run.input}</div>
                    </td>
                    <td>
                      <div className="agent-mini-cell">
                        <AgentMark
                          icon={run.agent?.icon}
                          color={run.agent?.color}
                          size="sm"
                        />
                        <span>{run.agent?.name}</span>
                      </div>
                    </td>
                    <td>
                      <div className="stacked-cell">
                        <span>{formatIntent(run.intent)}</span>
                        <small>v{run.version}</small>
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="mono">{formatDuration(run.latencyMs)}</td>
                    <td className="mono">{formatCost(run.costCents)}</td>
                    <td className="muted">{formatDate(run.startedAt)}</td>
                    <td>
                      <Link className="table-arrow" href={`/runs/${run.id}`}>
                        <ChevronRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Activity}
            title="没有匹配的运行"
            description="修改搜索条件，或者去 Playground 创建一次新运行。"
            action={
              <Link className="button button--primary" href="/playground">
                打开 Playground
              </Link>
            }
          />
        )}
      </article>
    </>
  );
}

