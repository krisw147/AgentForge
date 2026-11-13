# AgentForge Case Study

## Problem

Most AI demos show a successful prompt response. Production agent platforms must answer harder questions:

- What happens when a worker crashes after calling a tool?
- How are sensitive actions approved and audited?
- How do we prevent a new prompt version from reducing quality?
- How are MCP tools discovered, permissioned and observed?
- How can tenants and roles be isolated safely?

AgentForge addresses these questions with a runnable control plane rather than another chatbot UI.

## Solution

The platform provides:

1. Agent definitions and immutable versions
2. A durable database-backed execution queue
3. Independent workers with leases and heartbeats
4. Built-in and MCP tool gateways
5. Human approval and checkpoint resume
6. SSE execution traces
7. Regression evaluation and release gates
8. Server-side sessions, tenant memberships and RBAC

## Key Engineering Decisions

### Database queue instead of in-process execution

The API returns `202` immediately. Workers atomically claim queued runs, renew leases and persist every event. A crashed worker is recovered after lease expiry without exposing infrastructure details to the API caller.

### Event history plus materialized state

Current run status stays fast to query, while append-only events preserve model/tool decisions and support replay and audit.

### Approval as a durable state transition

Approval is not a modal that calls a tool directly. The run pauses at `waiting_approval`, stores the proposed tool arguments, then returns to the queue after a role-authorized decision.

### Tool annotations drive policy

MCP read-only and destructive annotations are persisted during discovery. Refund operations are explicit write tools that require human approval.

### Release checks as a production boundary

Draft versions are tested against a fixed dataset before publication. Accuracy, latency and cost thresholds create a reproducible release decision.

## Demonstration Metrics

- Automated API/integration tests: 15
- MCP stdio and Streamable HTTP tests: passing
- Production dependency vulnerabilities: 0
- Supported MCP transports: 2
- Runtime recovery verified from attempt 1 to attempt 2
- Approval resume produces a complete 12-event trace

## Resume Bullets

- Built a durable AgentOps platform with FastAPI, Next.js, PostgreSQL/SQLite, an independent leased worker and SSE event streaming.
- Designed versioned agent release gates that execute regression datasets and block publication when accuracy, P95 latency or cost exceed policy.
- Implemented MCP tool discovery and execution through an SDK bridge with stdio and Streamable HTTP, persistent sessions, JSON Schema, allowlists, health checks and sensitive-field redaction.
- Added server-side sessions, tenant memberships and Owner/Approver/Member permissions, including human approval and checkpoint resume for sensitive tool calls.

## Interview Questions to Expect

1. Why not execute agents inside the HTTP request?
2. What exactly happens when a worker dies during a tool call?
3. How is duplicate refund prevented?
4. Why keep immutable tool bindings after publishing?
5. How would you scale workers with PostgreSQL or Redis?
6. How does the MCP Bridge prevent arbitrary command execution?
7. How would you measure model quality and prevent regressions?

