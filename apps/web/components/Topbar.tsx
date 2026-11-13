"use client";

import { Bell, Command, LogOut, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AuthData } from "@/lib/types";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function Topbar() {
  const [mode, setMode] = useState("demo");
  const [auth, setAuth] = useState<AuthData | null>(null);

  useEffect(() => {
    Promise.all([api.status(), api.me()])
      .then(([status, currentAuth]) => {
        setMode(status.model.mode);
        setAuth(currentAuth);
      })
      .catch(() => undefined);
  }, []);

  const logout = async () => {
    await api.logout().catch(() => undefined);
    window.location.href = "/login";
  };

  return (
    <header className="topbar">
      <WorkspaceSwitcher />
      <div className="topbar-actions">
        <button className="search-trigger" type="button">
          <Search size={16} />
          <span>搜索 Agent、运行或订单号</span>
          <kbd>
            <Command size={11} /> K
          </kbd>
        </button>
        <button className="icon-button" type="button" aria-label="通知">
          <Bell size={18} />
          <span className="notification-dot" />
        </button>
        <button
          className="icon-button"
          onClick={logout}
          title="退出登录"
          type="button"
        >
          <LogOut size={17} />
        </button>
        <span className="topbar-divider" />
        <div className="topbar-env">
          <span className="env-dot" />
          {mode === "live" ? "Live" : "Demo"}
        </div>
        {auth ? (
          <div className="topbar-role">
            {auth.activeTenant.role}
          </div>
        ) : null}
      </div>
    </header>
  );
}

