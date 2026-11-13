"use client";

import {
  Activity,
  ArrowRight,
  Boxes,
  Braces,
  Check,
  Database,
  Download,
  Fingerprint,
  LockKeyhole,
  Network,
  PlugZap,
  RefreshCw,
  Server,
  ShieldCheck,
  TerminalSquare,
  TimerReset,
  Wrench
} from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import type {
  MCPCatalogServer,
  MCPServer,
  ToolDefinition
} from "@/lib/types";
import { formatDate } from "@/lib/format";

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [catalog, setCatalog] = useState<MCPCatalogServer[]>([]);
  const [role, setRole] = useState("viewer");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mcpError, setMcpError] = useState("");
  const [working, setWorking] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    setMcpError("");
    try {
      const [toolItems, serverItems, auth] = await Promise.all([
        api.tools(),
        api.mcpServers(),
        api.me()
      ]);
      setTools(toolItems);
      setServers(serverItems);
      setRole(auth.activeTenant.role);
      if (auth.activeTenant.role === "owner") {
        try {
          const catalogResult = await api.mcpCatalog();
          setCatalog(catalogResult.servers);
        } catch (err) {
          setMcpError((err as Error).message);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const register = async (bridgeServerId: string) => {
    setWorking(bridgeServerId);
    setMcpError("");
    try {
      await api.registerMCPServer(bridgeServerId);
      await load();
    } catch (err) {
      setMcpError((err as Error).message);
    } finally {
      setWorking("");
    }
  };

  const rediscover = async (serverId: string) => {
    setWorking(serverId);
    setMcpError("");
    try {
      await api.discoverMCPServer(serverId);
      await load();
    } catch (err) {
      setMcpError((err as Error).message);
    } finally {
      setWorking("");
    }
  };

  const healthCheck = async (serverId: string) => {
    setWorking(`health:${serverId}`);
    setMcpError("");
    try {
      await api.healthCheckMCPServer(serverId);
      await load();
    } catch (err) {
      setMcpError((err as Error).message);
    } finally {
      setWorking("");
    }
  };

  if (loading) return <LoadingState label="正在加载工具仓库" />;

  return (
    <>
      <PageHeader
        eyebrow="TOOL GATEWAY"
        title="工具仓库"
        description="所有能力通过统一网关执行，参数校验、权限、重试与审计在运行时统一处理。"
        actions={
          <span className="tool-count-chip">
            <Wrench size={14} />
            {tools.length} 个工具
          </span>
        }
      />

      {error ? (
        <div className="inline-alert inline-alert--danger">{error}</div>
      ) : null}

      {mcpError ? (
        <div className="inline-alert inline-alert--danger">{mcpError}</div>
      ) : null}

      <section className="tool-gateway-flow panel">
        <div className="gateway-node">
          <span>
            <TerminalSquare size={19} />
          </span>
          <strong>Agent Runtime</strong>
          <small>工具请求</small>
        </div>
        <ArrowRight size={18} />
        <div className="gateway-node gateway-node--active">
          <span>
            <ShieldCheck size={19} />
          </span>
          <strong>Tool Gateway</strong>
          <small>校验 · 权限 · 幂等</small>
        </div>
        <ArrowRight size={18} />
        <div className="gateway-node">
          <span>
            <Network size={19} />
          </span>
          <strong>Downstream</strong>
          <small>Mock API / MCP</small>
        </div>
        <div className="gateway-policies">
          <span>
            <TimerReset size={13} /> 12s timeout
          </span>
          <span>
            <Fingerprint size={13} /> idempotent
          </span>
          <span>
            <LockKeyhole size={13} /> allowlist
          </span>
        </div>
      </section>

      <section className="mcp-registry panel">
        <div className="panel-heading">
          <div>
            <h2>MCP Servers</h2>
            <p>通过官方 SDK 发现工具；服务端配置和连接由 MCP Bridge 管理。</p>
          </div>
          <span className="panel-chip">MCP BRIDGE</span>
        </div>
        <div className="mcp-server-grid">
          {servers.map((server) => (
            <article className="mcp-server-card" key={server.id}>
              <div className="mcp-server-top">
                <span className="mcp-server-icon">
                  <Server size={18} />
                </span>
                <StatusBadge status={server.status} />
              </div>
              <h3>{server.name}</h3>
              <code>{server.bridgeServerId}</code>
              <div className="mcp-server-meta">
                <span>{server.transport.toUpperCase()}</span>
                <span>{server.toolCount} tools</span>
                <span>{formatDate(server.lastDiscoveredAt)}</span>
              </div>
              <p>{server.lastError || "工具定义已同步到本地工具仓库。"}</p>
              {role === "owner" ? (
                <div className="mcp-server-actions">
                  <button
                    className="button button--secondary button--small"
                    disabled={working === server.id}
                    onClick={() => rediscover(server.id)}
                    type="button"
                  >
                    <RefreshCw size={13} />
                    {working === server.id ? "同步中…" : "刷新工具"}
                  </button>
                  <button
                    className="button button--secondary button--small"
                    disabled={working === `health:${server.id}`}
                    onClick={() => healthCheck(server.id)}
                    type="button"
                  >
                    <Activity size={13} />
                    {working === `health:${server.id}`
                      ? "检查中…"
                      : "健康检查"}
                  </button>
                </div>
              ) : null}
            </article>
          ))}

          {role === "owner"
            ? catalog
                .filter(
                  (item) =>
                    !servers.some(
                      (server) => server.bridgeServerId === item.id
                    )
                )
                .map((item) => (
                  <article
                    className="mcp-server-card mcp-server-card--available"
                    key={item.id}
                  >
                    <div className="mcp-server-top">
                      <span className="mcp-server-icon">
                        <PlugZap size={18} />
                      </span>
                      <span className="safe-chip">可导入</span>
                    </div>
                    <h3>{item.name}</h3>
                    <code>{item.id}</code>
                    <div className="mcp-server-meta">
                      <span>{item.transport.toUpperCase()}</span>
                      <span>{item.allowedTools.length} allowed</span>
                    </div>
                    <p>
                      将导入工具 Schema、只读标记和审批策略，不会保存任何子进程密钥。
                    </p>
                    <button
                      className="button button--primary button--small"
                      disabled={working === item.id}
                      onClick={() => register(item.id)}
                      type="button"
                    >
                      <Download size={13} />
                      {working === item.id ? "导入中…" : "导入并发现"}
                    </button>
                  </article>
                ))
            : null}

          {!servers.length && !catalog.length ? (
            <div className="mcp-registry-empty">
              <Server size={20} />
              <span>
                {role === "owner"
                  ? "暂无已注册的 MCP Server，请检查 Bridge 是否在线。"
                  : "当前工作区尚未导入 MCP Server。"}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="tool-grid">
        {tools.map((tool) => (
          <article className="panel tool-card" key={tool.id}>
            <div className="tool-card-head">
              <span className="tool-glyph">
                <Wrench size={18} />
              </span>
              <span
                className={
                  tool.requiresApproval ? "guard-chip" : "safe-chip"
                }
              >
                {tool.requiresApproval ? (
                  <>
                    <ShieldCheck size={12} /> 写操作
                  </>
                ) : (
                  <>
                    <Check size={12} /> 只读
                  </>
                )}
              </span>
            </div>
            {tool.source === "mcp" ? (
              <span className="mcp-source-chip">
                MCP · {tool.remoteName}
              </span>
            ) : null}
            <h2>{tool.name}</h2>
            <code>{tool.slug}()</code>
            <p>{tool.description}</p>
            <div className="tool-schema">
              <span>
                <Braces size={14} />
                JSON Schema
              </span>
              <code>
                {Object.keys(tool.schema?.properties || {}).join(", ") ||
                  "无参数"}
              </code>
            </div>
            <div className="tool-card-foot">
              <span className="tool-status-dot" />
              {tool.enabled === false ? "已停用" : "可用"}
              {tool.requiresApproval ? <span>人工审批</span> : null}
            </div>
          </article>
        ))}
      </section>

      <section className="tool-policy-grid">
        <article className="panel policy-card">
          <span className="policy-card-icon">
            <ShieldCheck size={19} />
          </span>
          <h3>敏感操作分级</h3>
          <p>写工具默认需要审批，只读查询可按 Agent 角色直接执行。</p>
        </article>
        <article className="panel policy-card">
          <span className="policy-card-icon">
            <TimerReset size={19} />
          </span>
          <h3>超时与重试</h3>
          <p>指数退避后重试，超过次数进入可控失败状态并保留现场。</p>
        </article>
        <article className="panel policy-card">
          <span className="policy-card-icon">
            <Database size={19} />
          </span>
          <h3>结果审计</h3>
          <p>工具参数、返回值、耗时和尝试次数全部写入运行事件。</p>
        </article>
      </section>
    </>
  );
}

