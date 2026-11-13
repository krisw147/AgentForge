"use client";

import {
  Check,
  CircleDot,
  CloudCog,
  Code2,
  Database,
  HeartPulse,
  KeyRound,
  Layers3,
  Server,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";

type Status = Awaited<ReturnType<typeof api.status>>;

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .status()
      .then(setStatus)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState label="正在读取系统配置" />;
  if (error || !status) {
    return <div className="error-panel">{error || "无法读取配置"}</div>;
  }

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURATION"
        title="系统设置"
        description="检查模型网关、持久化状态与安全能力。敏感凭据只从环境变量读取。"
        actions={
          <span className="live-indicator">
            <span />
            服务健康
          </span>
        }
      />

      <div className="settings-grid">
        <article className="panel settings-main-card">
          <div className="settings-card-head">
            <span className="settings-icon">
              <Sparkles size={19} />
            </span>
            <div>
              <h2>模型网关</h2>
              <p>所有 Agent 共用统一的路由、降级和计费入口</p>
            </div>
            <StatusBadge
              status={status.model.mode === "live" ? "completed" : "draft"}
              label={status.model.mode === "live" ? "已连接" : "演示模式"}
            />
          </div>
          <div className="settings-fields">
            <div>
              <span>Provider</span>
              <code>{status.model.provider}</code>
            </div>
            <div>
              <span>Chat model</span>
              <code>{status.model.name}</code>
            </div>
            <div>
              <span>Embedding model</span>
              <code>{status.model.embeddingModel}</code>
            </div>
            <div>
              <span>环境</span>
              <code>{status.environment}</code>
            </div>
          </div>
          <div className="settings-note">
            <KeyRound size={17} />
            <div>
              <strong>接入真实模型</strong>
              <p>
                在项目根目录创建 `.env`，填写
                `AGENTFORGE_LLM_BASE_URL`、`AGENTFORGE_LLM_API_KEY` 和
                `AGENTFORGE_LLM_MODEL`，重启 API 后自动切换。
              </p>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="settings-card-head">
            <span className="settings-icon settings-icon--green">
              <Server size={19} />
            </span>
            <div>
              <h2>运行时</h2>
              <p>执行引擎与持久化状态</p>
            </div>
          </div>
          <div className="runtime-settings-list">
            <div>
              <Database size={16} />
              <span>
                <strong>状态存储</strong>
                <small>{status.runtime.stateStore}</small>
              </span>
              <span className="setting-check">
                <Check size={13} />
              </span>
            </div>
            <div>
              <CircleDot size={16} />
              <span>
                <strong>检查点</strong>
                <small>暂停后可恢复</small>
              </span>
              <span className="setting-check">
                <Check size={13} />
              </span>
            </div>
            <div>
              <ShieldCheck size={16} />
              <span>
                <strong>人工审批</strong>
                <small>敏感工具策略</small>
              </span>
              <span className="setting-check">
                <Check size={13} />
              </span>
            </div>
            <div>
              <Layers3 size={16} />
              <span>
                <strong>持久化队列</strong>
                <small>原子领取与租约恢复</small>
              </span>
              <span className="setting-check">
                <Check size={13} />
              </span>
            </div>
            <div>
              <HeartPulse size={16} />
              <span>
                <strong>Worker 心跳</strong>
                <small>异常任务自动接管</small>
              </span>
              <span className="setting-check">
                <Check size={13} />
              </span>
            </div>
            <div>
              <Code2 size={16} />
              <span>
                <strong>故障注入</strong>
                <small>支持超时与重试测试</small>
              </span>
              <span className="setting-check">
                <Check size={13} />
              </span>
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="settings-card-head">
            <span className="settings-icon settings-icon--blue">
              <CloudCog size={19} />
            </span>
            <div>
              <h2>部署目标</h2>
              <p>本地优先，随时迁移到 Docker</p>
            </div>
          </div>
          <div className="deployment-steps">
            <div className="complete">
              <span>1</span>
              <div>
                <strong>本地开发</strong>
                <small>SQLite + Next.js + FastAPI</small>
              </div>
            </div>
            <div>
              <span>2</span>
              <div>
                <strong>容器化</strong>
                <small>PostgreSQL + Docker Compose</small>
              </div>
            </div>
            <div>
              <span>3</span>
              <div>
                <strong>公网演示</strong>
                <small>HTTPS、日志和监控</small>
              </div>
            </div>
          </div>
        </article>

        <article className="panel security-settings">
          <div className="settings-card-head">
            <span className="settings-icon settings-icon--amber">
              <ShieldCheck size={19} />
            </span>
            <div>
              <h2>安全边界</h2>
              <p>当前演示已启用的基础保护</p>
            </div>
          </div>
          <ul>
            <li>
              <Check size={14} />
              工作区数据隔离
            </li>
            <li>
              <Check size={14} />
              写工具人工审批
            </li>
            <li>
              <Check size={14} />
              运行与审批全量审计
            </li>
            <li>
              <Check size={14} />
              凭据仅通过环境变量注入
            </li>
          </ul>
          <p className="security-footnote">
            公网部署前还应接入正式身份认证、TLS、速率限制和密钥托管服务。
          </p>
        </article>
      </div>
    </>
  );
}
