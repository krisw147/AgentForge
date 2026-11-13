# AgentForge 5-Minute Demo Script

## Preparation

```powershell
cd "C:\Users\王浩旭\Desktop\工作\AgentForge"
npm run dev
```

Open `http://localhost:3000/login`.

Demo accounts use password `demo1234`.

## 0:00-0:30 Dashboard

Log in as `lin@forward.tech`.

Show:

- Live DeepSeek mode
- Total runs and success rate
- Durable queue and MCP Bridge in system settings
- Approval queue

Message:

> This is not a chat wrapper. It is a control plane around agent execution.

## 0:30-1:10 Roles and Workspaces

Show the Owner badge and workspace switch.

Optionally log in as `zhou@forward.tech`:

- Approval navigation disappears
- Pending approval count becomes zero

Message:

> Authentication is enforced by server-side sessions and tenant memberships; headers cannot switch tenants.

## 1:10-2:00 MCP Tools

Open **工具仓库**.

Show:

- Local stdio MCP Server
- Remote Streamable HTTP MCP Server
- Four discovered tools on each server
- Health check buttons
- Read-only and approval annotations

Click **健康检查** on the HTTP server.

Message:

> The bridge manages persistent MCP sessions and enforces a command/tool allowlist.

## 2:00-2:50 Draft and Release Gate

Open **Agents → 退款运营助手 → 版本**.

Create a Draft version.

Open **工具**:

- Bind `mcp__order-server__get_order`
- Bind `mcp__order-server__issue_refund`
- Save bindings

Back in **版本**, click **评测并发布**.

Show:

- Eight regression cases
- Accuracy, P95 latency and average cost thresholds
- Passing decision and release audit record

Message:

> A prompt change cannot reach users unless measured quality, latency and cost remain within budget.

## 2:50-3:35 Live Agent and MCP Trace

Open **Playground**.

Select the latest published version and send:

```text
帮我查一下订单 ORD-2026-1088 现在是什么状态？
```

Open the full Trace.

Highlight:

```json
{
  "tool": "get_order",
  "source": "mcp",
  "remote_name": "get_order"
}
```

Message:

> The API returned immediately, an independent worker claimed the task, and SSE streamed each persisted step to the browser.

## 3:35-4:30 Approval and Resume

Send the refund example.

Show:

- Run pauses at `waiting_approval`
- Approval contains order and refund context
- Approve as Owner or Approver
- Run re-enters the durable queue
- New worker claims attempt 2
- MCP `issue_refund` executes
- Trace shows the MCP refund ID

Message:

> The sensitive action is not executed by the web request. It is checkpointed, approved, requeued and resumed.

## 4:30-5:00 Reliability

Show a run containing `job.recovered`.

Explain:

- Worker heartbeat renews a lease
- Process crash leaves a non-expired lease
- After expiry, another worker atomically claims the task
- Idempotency prevents duplicate side effects

Closing:

> AgentForge demonstrates the complete lifecycle: define, bind tools, execute durably, observe, approve, evaluate and release.

## Optional Failure Demo

Run `npm run dev:main` and `npm run dev:worker` in separate terminals.

1. Select **慢工具（15 秒）**
2. Start a run
3. Stop the worker
4. Wait 12 seconds for lease expiry
5. Start the worker again
6. Show `job.recovered` and attempt count 2

