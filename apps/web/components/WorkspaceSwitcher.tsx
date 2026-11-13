"use client";

import { ChevronsUpDown, Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Workspace } from "@/lib/types";

export function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [value, setValue] = useState("");
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((auth) => {
        setWorkspaces(auth.workspaces);
        setValue(auth.activeTenant.slug);
      })
      .catch(() => undefined);
  }, []);

  const change = async (slug: string) => {
    setValue(slug);
    setSwitching(true);
    try {
      await api.switchWorkspace(slug);
      window.location.reload();
    } finally {
      setSwitching(false);
    }
  };

  const active = workspaces.find((workspace) => workspace.slug === value);
  return (
    <label className="workspace-switcher">
      <Building2 size={15} />
      <span className="workspace-switcher-label">
        {active?.name || "星河科技"}
      </span>
      <select
        aria-label="切换工作区"
        disabled={switching}
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        {(workspaces.length
          ? workspaces
          : [
              {
                id: "forward",
                name: "星河科技",
                slug: "forward-tech",
                plan: "team",
                role: "owner",
                active: true
              }
            ]
        ).map((workspace) => (
          <option key={workspace.id} value={workspace.slug}>
            {workspace.name}
          </option>
        ))}
      </select>
      <ChevronsUpDown size={14} />
    </label>
  );
}

