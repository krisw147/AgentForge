export type AgentSummary = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  status: string;
  runCount: number;
  versionCount: number;
  latestVersion: AgentVersion | null;
  latestDraft: AgentVersion | null;
  updatedAt: string;
};

export type AgentVersion = {
  id: string;
  version: string;
  model: string;
  systemPrompt: string;
  maxSteps: number;
  budgetCents: number;
  config: Record<string, unknown>;
  status: string;
  createdAt: string;
};

export type Approval = {
  id: string;
  status: string;
  reason: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string;
};

export type RunEvent = {
  id: string;
  seq: number;
  type: string;
  title: string;
  payload: Record<string, unknown>;
  latencyMs: number;
  createdAt: string;
};

export type Run = {
  id: string;
  status: string;
  input: string;
  output: string;
  intent: string;
  trigger: string;
  faultMode: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  workerId: string | null;
  attemptCount: number;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  resumeAction: string | null;
  startedAt: string;
  finishedAt: string | null;
  agent: {
    id: string;
    name: string;
    icon: string;
    color: string;
  } | null;
  version: string | null;
  approval: Approval | null;
  events?: RunEvent[];
  systemPrompt?: string;
  model?: string;
};

export type DashboardData = {
  tenant: { id: string; name: string; slug: string };
  user: { id: string; name: string; role: string };
  stats: {
    totalRuns: number;
    completedRuns: number;
    successRate: number;
    activeAgents: number;
    pendingApprovals: number;
    avgLatencyMs: number;
    totalCostCents: number;
  };
  trend: Array<{ date: string; label: string; runs: number }>;
  recentRuns: Run[];
  approvalQueue: Array<{ approval: Approval; run: Run }>;
  evaluations: Array<{
    id: string;
    accuracy: number;
    successRate: number;
    p95LatencyMs: number;
    passedCases: number;
    totalCases: number;
    createdAt: string;
  }>;
  runtime: { model: string; mode: string; status: string };
};

export type AgentDetail = AgentSummary & {
  versions: AgentVersion[];
  tools: ToolDefinition[];
  toolBindings: Record<string, string[]>;
  recentRuns: Run[];
  releaseChecks: ReleaseCheck[];
};

export type ReleaseCheck = {
  id: string;
  agentVersionId: string;
  evalRunId: string;
  passed: boolean;
  minAccuracy: number;
  maxP95LatencyMs: number;
  maxAvgCostCents: number;
  actualAccuracy: number;
  actualP95LatencyMs: number;
  actualAvgCostCents: number;
  reason: string;
  createdAt: string;
};

export type ToolDefinition = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind?: string;
  source?: "builtin" | "mcp";
  enabled?: boolean;
  requiresApproval: boolean;
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  mcpServerId?: string | null;
  remoteName?: string | null;
  schema: Record<string, unknown>;
};

export type MCPServer = {
  id: string;
  bridgeServerId: string;
  name: string;
  transport: string;
  status: string;
  toolCount: number;
  lastDiscoveredAt: string | null;
  lastError: string;
  updatedAt: string;
};

export type MCPCatalogServer = {
  id: string;
  name: string;
  transport: string;
  allowedTools: string[];
  requiresApproval: string[];
};

export type EvalDataset = {
  id: string;
  name: string;
  description: string;
  caseCount: number;
  cases: Array<{
    id: string;
    name: string;
    input: string;
    expectedIntent: string;
    expectedOutcome: string;
  }>;
};

export type EvalResult = {
  id: string;
  caseName: string;
  input: string;
  actualIntent: string;
  actualOutcome: string;
  expectedIntent: string;
  expectedOutcome: string;
  passed: boolean;
  latencyMs: number;
  costCents: number;
  runId: string | null;
};

export type EvalRun = {
  id: string;
  status: string;
  agentId: string;
  agentVersionId: string;
  datasetName: string;
  version: string;
  accuracy: number;
  successRate: number;
  p95LatencyMs: number;
  avgCostCents: number;
  passedCases: number;
  totalCases: number;
  createdAt: string;
  results: EvalResult[];
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
  active: boolean;
};

export type AuthData = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  activeTenant: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
  workspaces: Workspace[];
};

