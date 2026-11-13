"use client";

import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  ShieldCheck,
  Sparkles,
  Workflow
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

const demoAccounts = [
  {
    email: "lin@forward.tech",
    role: "Owner",
    detail: "全部权限 · 两个工作区"
  },
  {
    email: "chen@forward.tech",
    role: "Approver",
    detail: "敏感操作审批"
  },
  {
    email: "zhou@forward.tech",
    role: "Member",
    detail: "运行与编辑，不可审批"
  }
];

export default function LoginPage() {
  const [email, setEmail] = useState("lin@forward.tech");
  const [password, setPassword] = useState("demo1234");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .me()
      .then(() => window.location.replace("/"))
      .catch(() => undefined);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.login(email, password);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand">
          <span className="brand-mark">
            <Sparkles size={21} />
          </span>
          <span>
            <strong>AgentForge</strong>
            <small>Agent Control Plane</small>
          </span>
        </div>
        <div className="login-brand-copy">
          <span className="page-eyebrow">PRODUCTION CONTROL PLANE</span>
          <h1>
            让每一次 Agent
            <br />
            决策都可信。
          </h1>
          <p>
            统一管理运行、权限、审批、检查点和质量回归。
            从原型走向可审计的智能应用平台。
          </p>
        </div>
        <div className="login-feature-list">
          <div>
            <Workflow size={18} />
            <span>
              <strong>可靠执行</strong>
              <small>Worker 租约与故障恢复</small>
            </span>
          </div>
          <div>
            <ShieldCheck size={18} />
            <span>
              <strong>权限边界</strong>
              <small>租户隔离与敏感操作审批</small>
            </span>
          </div>
          <div>
            <Bot size={18} />
            <span>
              <strong>持续评测</strong>
              <small>版本质量、延迟与成本对比</small>
            </span>
          </div>
        </div>
        <div className="login-brand-foot">
          <CheckCircle2 size={14} />
          DeepSeek 实时模型 · 持久化 Trace
        </div>
      </section>

      <section className="login-form-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-card-head">
            <span className="login-lock">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h2>登录工作区</h2>
              <p>使用你的企业账号继续</p>
            </div>
          </div>

          <label className="login-field">
            <span>工作邮箱</span>
            <input
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
              type="email"
              value={email}
            />
          </label>

          <label className="login-field">
            <span>密码</span>
            <div className="password-field">
              <input
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="输入密码"
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                onClick={() => setShowPassword((value) => !value)}
                type="button"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {error ? (
            <div className="inline-alert inline-alert--danger">{error}</div>
          ) : null}

          <button
            className="button button--primary login-submit"
            disabled={submitting}
            type="submit"
          >
            {submitting ? (
              <>
                <span className="spinner spinner--light" />
                正在登录
              </>
            ) : (
              <>
                进入控制台
                <ArrowRight size={16} />
              </>
            )}
          </button>

          <div className="demo-accounts">
            <div className="demo-accounts-title">
              <span>演示账号</span>
              <small>密码统一为 demo1234</small>
            </div>
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                onClick={() => {
                  setEmail(account.email);
                  setPassword("demo1234");
                  setError("");
                }}
                type="button"
              >
                <span>
                  <strong>{account.role}</strong>
                  <small>{account.email}</small>
                </span>
                <em>{account.detail}</em>
              </button>
            ))}
          </div>
          <p className="login-footnote">
            演示密码仅用于本地作品集环境。公网部署时应连接企业 SSO/OIDC。
          </p>
        </form>
      </section>
    </main>
  );
}

