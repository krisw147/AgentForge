"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { AuthData } from "@/lib/types";
import { LoadingState } from "./LoadingState";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (pathname === "/login") return;
    api
      .me()
      .then(setAuth)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          window.location.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "无法验证登录状态");
      });
  }, [pathname]);

  if (pathname === "/login") return <>{children}</>;

  if (error) {
    return (
      <div className="auth-screen">
        <div className="error-panel">
          <div>
            <strong>无法连接 AgentForge API</strong>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!auth) {
    return (
      <div className="auth-screen">
        <LoadingState label="正在验证登录状态" />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Topbar />
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}

