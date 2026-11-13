"use client";

import {
  ArrowRight,
  Bot,
  GitBranch,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  X
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AgentMark } from "@/components/AgentMark";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { AgentSummary } from "@/lib/types";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    system_prompt:
      "你是一名企业运营助手。请先理解用户意图，只在获取到可信事实后执行操作。",
    budget_cents: 20
  });

  const load = () => {
    setLoading(true);
    api
      .agents()
      .then(setAgents)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = useMemo(
    () =>
      agents.filter((agent) => {
        const matchesQuery =
          !query ||
          `${agent.name} ${agent.description}`
            .toLowerCase()
            .includes(query.toLowerCase());
        const matchesFilter = filter === "all" || agent.status === filter;
        return matchesQuery && matchesFilter;
      }),
    [agents, filter, query]
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const agent = await api.createAgent(form);
      window.location.href = `/agents/${agent.id}`;
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="AGENT REGISTRY"
        title="Agents"
        description="定义版本、工具权限与运行预算，让每次执行都可追踪、可回滚。"
        actions={
          <button
            className="button button--primary"
            onClick={() => setModalOpen(true)}
            type="button"
          >
            <Plus size={16} />
            新建 Agent
          </button>
        }
      />

      {error ? (
        <div className="inline-alert inline-alert--danger">{error}</div>
      ) : null}

      <div className="toolbar">
        <div className="filter-tabs">
          {[
            ["all", "全部"],
            ["active", "运行中"],
            ["draft", "草稿"]
          ].map(([value, label]) => (
            <button
              className={filter === value ? "filter-tab active" : "filter-tab"}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {label}
              <span>
                {value === "all"
                  ? agents.length
                  : agents.filter((agent) => agent.status === value).length}
              </span>
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Agent"
            value={query}
          />
        </label>
      </div>

      {loading ? (
        <LoadingState label="正在读取 Agent 注册表" />
      ) : (
        <section className="agent-grid">
          {filtered.map((agent) => (
            <article className="agent-card" key={agent.id}>
              <div className="agent-card-top">
                <AgentMark icon={agent.icon} color={agent.color} size="lg" />
                <div className="agent-card-actions">
                  <StatusBadge status={agent.status} />
                  <button className="icon-button icon-button--small" type="button">
                    <MoreHorizontal size={17} />
                  </button>
                </div>
              </div>
              <div className="agent-card-copy">
                <Link href={`/agents/${agent.id}`}>
                  <h2>{agent.name}</h2>
                </Link>
                <p>{agent.description}</p>
              </div>
              <div className="agent-card-tags">
                <span>
                  <GitBranch size={13} />
                  v
                  {agent.latestVersion?.version ||
                    agent.latestDraft?.version ||
                    "0.0.0"}
                </span>
                <span>
                  {agent.latestVersion?.model ||
                    agent.latestDraft?.model ||
                    "model"}
                </span>
                {!agent.latestVersion && agent.latestDraft ? (
                  <span>草稿待发布</span>
                ) : null}
              </div>
              <div className="agent-card-metrics">
                <div>
                  <strong>{agent.runCount}</strong>
                  <span>累计运行</span>
                </div>
                <div>
                  <strong>{agent.versionCount}</strong>
                  <span>版本</span>
                </div>
                <div>
                  <strong>{formatDate(agent.updatedAt, false)}</strong>
                  <span>最近更新</span>
                </div>
              </div>
              <Link className="agent-card-link" href={`/agents/${agent.id}`}>
                查看 Agent
                <ArrowRight size={15} />
              </Link>
            </article>
          ))}
          <button
            className="agent-card agent-create-card"
            onClick={() => setModalOpen(true)}
            type="button"
          >
            <span className="create-agent-icon">
              <Plus size={22} />
            </span>
            <strong>创建一个新的 Agent</strong>
            <p>从提示词、工具和预算开始配置你的运行时。</p>
          </button>
        </section>
      )}

      {modalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <span className="modal-icon">
                  <Sparkles size={18} />
                </span>
                <h2>新建 Agent</h2>
                <p>创建首个可发布版本，稍后可以在详情页继续迭代。</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setModalOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <form className="form-stack" onSubmit={submit}>
              <label>
                <span>Agent 名称</span>
                <input
                  autoFocus
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="例如：售后政策助手"
                  required
                  value={form.name}
                />
              </label>
              <label>
                <span>一句话描述</span>
                <input
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                  placeholder="这个 Agent 负责什么？"
                  value={form.description}
                />
              </label>
              <label>
                <span>系统提示词</span>
                <textarea
                  onChange={(event) =>
                    setForm({ ...form, system_prompt: event.target.value })
                  }
                  rows={6}
                  value={form.system_prompt}
                />
              </label>
              <label>
                <span>单次运行预算（美分）</span>
                <input
                  min={1}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      budget_cents: Number(event.target.value)
                    })
                  }
                  type="number"
                  value={form.budget_cents}
                />
              </label>
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
                  {saving ? "创建中…" : "创建并配置"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

