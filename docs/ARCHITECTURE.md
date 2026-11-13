# AgentForge Architecture

## 1. System Goal

AgentForge is a self-hosted control plane for agents that execute tools on behalf of users. The design focuses on four properties:

1. Durable execution: a worker crash must not lose work.
2. Human control: sensitive tools require an explicit approval decision.
3. Traceability: every model, retrieval and tool step is persisted.
4. Release safety: a new agent version reaches production only after regression checks pass.

## 2. Component Map

```text
Browser
  |
  +-- Next.js Web
  |
  +-- FastAPI control plane
        |-- Session and RBAC
        |-- Agent/version registry
        |-- Queue and approval API
        |-- Evaluation and release gates
        |-- SSE event stream
        |
        +-- PostgreSQL or SQLite
        |
        +-- Runtime Worker
              |-- lease/heartbeat
              |-- checkpoint resume
              |-- tool gateway
              |-- trace/event writer
              |
              +-- MCP Bridge
                    |-- stdio MCP Server
                    |-- Streamable HTTP MCP Server
              |
              +-- OpenAI-compatible model API
```

## 3. Durable Run Lifecycle

```text
queued
  -> running
  -> waiting_approval -> queued -> running -> completed
  -> completed
  -> failed
  -> rejected
  -> needs_input
```

The API creates a queued run and returns `202`. A worker claims it using an atomic status update and records:

- Worker ID
- Attempt count
- Lease expiry
- Heartbeat timestamp
- Resume action

The lease expires after 12 seconds without a heartbeat. A healthy worker extends it every 4 seconds. If a worker exits unexpectedly, the next worker recovers the expired run and records a `job.recovered` event.

Tool operations use idempotency keys. Refund simulation and MCP refunds reuse a previously persisted successful result when the same run is resumed.

## 4. Event and Checkpoint Model

Run events are append-only records:

```text
run.queued
run.started
intent.detected
retrieval.completed
tool.completed / tool.failed
approval.requested
approval.resolved
run.queued
run.resumed
run.completed
```

Every execution node commits its event before the next node starts. This allows SSE clients to observe partial traces and preserves enough evidence for debugging after a worker crash.

The run row stores the current materialized state; the event rows preserve the audit history.

## 5. Safety and Permissions

Authentication uses server-side sessions:

- PBKDF2 password hashes
- Random session token stored as SHA-256 hash
- HttpOnly and SameSite=Lax cookies
- Twelve-hour session lifetime
- Origin validation for mutating requests

RBAC is scoped through `Membership(user, tenant, role)`:

| Role | Main permissions |
|---|---|
| Owner | Full control, approvals, releases |
| Approver | Read and approve sensitive operations |
| Member | Run agents, edit drafts, run evaluations |
| Viewer | Read-only access |

Agent queries always include the authenticated tenant. A manually forged tenant header has no effect.

## 6. MCP Tool Gateway

MCP servers are registered in a tenant-scoped registry. Discovery calls `tools/list` and imports:

- Remote name and title
- Description
- JSON Schema
- read-only/destructive/idempotent annotations
- approval policy

The Bridge owns transport details:

- stdio child-process allowlist
- Streamable HTTP URL allowlist
- environment-variable-only headers
- 15-second timeouts
- persistent sessions with idle eviction
- health checks
- input/output size limits

The runtime prefers a bound MCP implementation over a built-in tool with the same logical name. MCP call metadata and source IDs are written into the trace.

## 7. Release Gate

New versions start in `draft`. A release check runs a fixed evaluation dataset and compares:

- minimum accuracy
- maximum P95 latency
- maximum average cost

Only a passing check publishes the version. The previous published version becomes `superseded`. `ReleaseCheck` rows preserve the thresholds, actual metrics, evaluator, and decision reason.

Tool bindings are immutable after publication. Cloning a Draft keeps only enabled tools from the previous version.

## 8. Deployment

Local development uses SQLite and a local MCP Bridge. Production uses:

- PostgreSQL
- API and Worker containers
- Next.js standalone container
- two MCP server transports
- Caddy for TLS and reverse proxying

PostgreSQL task allocation uses `FOR UPDATE SKIP LOCKED`; SQLite uses an atomic conditional update for local development.

## 9. Tradeoffs

- The worker currently polls the database. This is simple, portable and sufficient for the demo. Redis Streams can be added later without changing run semantics.
- Retrieval is lexical. The retrieval interface can be replaced with pgvector and a reranker.
- Evaluation is synchronous from the API caller's perspective. In production it should be a separate queued evaluation job.
- The bridge runs trusted server configuration. MCP OAuth and per-domain egress policy are required before accepting arbitrary remote servers.
- The default demo accounts are intentionally public. Public production use requires SSO or invited accounts.

## 10. Interview Discussion Topics

1. Why the run event log is separate from the current run row.
2. How lease expiry prevents two workers from processing a task indefinitely.
3. Why tool idempotency matters after a process crash.
4. Why tool bindings become immutable after publication.
5. How MCP output can introduce prompt injection and why it is treated as untrusted data.
6. Why release gates are better than manual prompt comparison.
7. How evaluation should be moved to a distributed queue at scale.

