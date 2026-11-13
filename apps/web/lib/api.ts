import type {
  AgentDetail,
  AgentSummary,
  AgentVersion,
  AuthData,
  DashboardData,
  EvalDataset,
  EvalRun,
  MCPCatalogServer,
  MCPServer,
  Run,
  ToolDefinition,
  Workspace
} from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000";

export function runStreamUrl(runId: string): string {
  return `${API_URL}/api/runs/${encodeURIComponent(runId)}/stream`;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {})
    },
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.detail || `请求失败 (${response.status})`,
      response.status
    );
  }
  return response.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthData>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<AuthData>("/api/auth/me"),
  switchWorkspace: (slug: string) =>
    request<AuthData>("/api/auth/switch-workspace", {
      method: "POST",
      body: JSON.stringify({ slug })
    }),
  dashboard: () => request<DashboardData>("/api/dashboard"),
  workspaces: () => request<Workspace[]>("/api/auth/workspaces"),
  agents: () => request<AgentSummary[]>("/api/agents"),
  agent: (id: string) => request<AgentDetail>(`/api/agents/${id}`),
  createAgent: (body: object) =>
    request<AgentSummary>("/api/agents", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  createVersion: (id: string, body: object) =>
    request<AgentVersion>(`/api/agents/${id}/versions`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  setVersionTools: (agentId: string, versionId: string, toolIds: string[]) =>
    request<{ versionId: string; tools: ToolDefinition[] }>(
      `/api/agents/${agentId}/versions/${versionId}/tools`,
      {
        method: "PUT",
        body: JSON.stringify({ tool_ids: toolIds })
      }
    ),
  releaseCheck: (agentId: string, versionId: string, body: object) =>
    request<{
      id: string;
      checkId: string;
      passed: boolean;
      accuracy: number;
      p95LatencyMs: number;
      avgCostCents: number;
      reason: string;
    }>(`/api/agents/${agentId}/versions/${versionId}/release-check`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  runs: (params = "") => request<Run[]>(`/api/runs${params}`),
  run: (id: string) => request<Run>(`/api/runs/${id}`),
  createRun: (body: object) =>
    request<Run>("/api/runs", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  replayRun: (id: string) =>
    request<Run>(`/api/runs/${id}/replay`, { method: "POST" }),
  approvals: (status = "pending") =>
    request<Array<{ approval: Run["approval"]; run: Run }>>(
      `/api/approvals?status=${status}`
    ),
  decideApproval: (id: string, approved: boolean, note: string) =>
    request<Run>(`/api/approvals/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ approved, note })
    }),
  tools: () => request<ToolDefinition[]>("/api/tools"),
  mcpCatalog: () =>
    request<{ servers: MCPCatalogServer[] }>("/api/mcp/catalog"),
  mcpServers: () => request<MCPServer[]>("/api/mcp/servers"),
  registerMCPServer: (bridgeServerId: string) =>
    request<{
      server: MCPServer;
      tools: ToolDefinition[];
      latencyMs: number;
    }>("/api/mcp/servers", {
      method: "POST",
      body: JSON.stringify({ bridge_server_id: bridgeServerId })
    }),
  discoverMCPServer: (serverId: string) =>
    request<{
      server: MCPServer;
      tools: ToolDefinition[];
      latencyMs: number;
    }>(`/api/mcp/servers/${serverId}/discover`, { method: "POST" }),
  healthCheckMCPServer: (serverId: string) =>
    request<{ serverId: string; status: string; latencyMs: number }>(
      `/api/mcp/servers/${serverId}/health`,
      { method: "POST" }
    ),
  datasets: () => request<EvalDataset[]>("/api/evals/datasets"),
  evalRuns: () => request<EvalRun[]>("/api/evals/runs"),
  runEvaluation: (body: object) =>
    request<{ id: string; status: string; accuracy: number }>("/api/evals/runs", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  status: () =>
    request<{
      environment: string;
      tenant: string;
      model: {
        mode: string;
        provider: string;
        name: string;
        embeddingModel: string;
      };
      runtime: {
        stateStore: string;
        checkpointing: boolean;
        humanApproval: boolean;
        faultInjection: boolean;
        durableQueue: boolean;
        workerHeartbeat: boolean;
      };
      mcpBridge: {
        configured: boolean;
        url: string;
        status: string;
      };
    }>("/api/system/status")
};
