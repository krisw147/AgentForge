"use client";

import {
  Activity,
  Blocks,
  Bot,
  Boxes,
  CheckCircle2,
  FlaskConical,
  Gauge,
  Settings,
  Sparkles,
  Wrench
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const nav = [
  { href: "/", label: "概览", icon: Gauge },
  { href: "/playground", label: "Playground", icon: FlaskConical },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/runs", label: "运行记录", icon: Activity },
  { href: "/approvals", label: "审批中心", icon: CheckCircle2 },
  { href: "/evaluations", label: "评测中心", icon: Boxes },
  { href: "/tools", label: "工具仓库", icon: Wrench }
];

export function Sidebar() {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);
  const [modelName, setModelName] = useState("connecting…");
  const [stateStore, setStateStore] = useState("database");
  const [userName, setUserName] = useState("加载中");
  const [userRole, setUserRole] = useState("viewer");

  useEffect(() => {
    Promise.all([api.dashboard(), api.status()])
      .then(([dashboard, status]) => {
        setPendingCount(dashboard.stats.pendingApprovals);
        setModelName(status.model.name);
        setStateStore(status.runtime.stateStore);
        setUserName(dashboard.user.name);
        setUserRole(dashboard.user.role);
      })
      .catch(() => undefined);
  }, []);

  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <span className="brand-mark">
          <Sparkles size={20} />
        </span>
        <span>
          <strong>AgentForge</strong>
          <small>Agent Control Plane</small>
        </span>
      </Link>

      <div className="sidebar-section-label">工作台</div>
      <nav className="sidebar-nav">
        {nav
          .filter(
            (item) =>
              item.href !== "/approvals" ||
              ["owner", "approver"].includes(userRole)
          )
          .map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              className={active ? "nav-item nav-item--active" : "nav-item"}
              href={item.href}
              key={item.href}
            >
              <Icon size={17} />
              <span>{item.label}</span>
              {item.href === "/approvals" && pendingCount > 0 ? (
                <span className="nav-count">{pendingCount}</span>
              ) : null}
            </Link>
          );
          })}
      </nav>

      <div className="sidebar-section-label sidebar-section-label--spaced">
        系统
      </div>
      <nav className="sidebar-nav">
        <Link
          className={
            pathname.startsWith("/settings")
              ? "nav-item nav-item--active"
              : "nav-item"
          }
          href="/settings"
        >
          <Settings size={17} />
          <span>系统设置</span>
        </Link>
      </nav>

      <div className="sidebar-footer">
        <div className="runtime-card">
          <div className="runtime-card-top">
            <span className="runtime-pulse" />
            <span>Runtime online</span>
          </div>
          <strong>{modelName}</strong>
          <span>{stateStore} checkpoint · v1.0.0</span>
        </div>
        <Link className="user-chip" href="/settings">
          <span className="avatar">{userName.slice(0, 1)}</span>
          <span>
            <strong>{userName}</strong>
            <small>{userRole}</small>
          </span>
          <Blocks size={15} />
        </Link>
      </div>
    </aside>
  );
}

