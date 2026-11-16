# AgentForge 面试题库与参考答案

答案以当前代码和 `v1.0.0` 实现为准。回答时先说结论，再给机制，最后说明生产化
取舍。

## 一、项目定位

### 1. 用一句话介绍 AgentForge

AgentForge 是一个可自托管的 Agent Runtime 与 AgentOps 控制平面，覆盖 Agent
版本管理、持久化任务执行、工具与 MCP 接入、人工审批、Trace、评测门禁和多租户
RBAC。

### 2. 它和普通 Chatbot Demo 有什么区别？

普通 Demo 主要证明模型能回答，AgentForge 关注模型执行之后的问题：任务如何排队、
Worker 崩溃如何恢复、敏感工具如何审批、每一步如何审计、版本如何证明质量没有
退化。核心产品对象是 Run、Trace、Approval、Tool 和 ReleaseCheck，而不是聊天记录。

### 3. 为什么选择退款运营作为演示场景？

退款链路同时包含意图识别、知识检索、订单查询、写工具、人工审批、失败重试和
审计，几乎覆盖 Agent 平台最关键的风险点。相比问答场景，它更能证明“执行平台”
而不是“模型包装器”。

## 二、架构与持久化执行

### 4. 为什么不在 HTTP 请求里直接执行 Agent？

Agent 执行可能包含多轮模型调用、检索和外部工具，延迟不可控。API 直接等待会造成
请求超时、连接占用，并且进程退出后任务丢失。当前设计是 API 创建 `queued` Run
后返回 202，由独立 Worker 领取并执行。

### 5. 一次 Run 的状态如何流转？

主要状态为：

```text
queued -> running -> completed
queued -> running -> failed
queued -> running -> needs_input
queued -> running -> waiting_approval -> queued -> running -> completed
queued -> running -> waiting_approval -> rejected
```

`waiting_approval` 不是内存中的暂停点，而是数据库状态；审批通过后任务重新入队，
Worker 从已保存的检查点恢复。

### 6. Worker 如何安全领取任务？

PostgreSQL 使用 `FOR UPDATE SKIP LOCKED` 选择最早的可执行任务；SQLite 使用
“状态仍为 queued 才更新”的条件更新，避免两个 Worker 同时领取同一条 Run。
领取后写入 Worker ID、租约到期时间、心跳和递增后的尝试次数。

### 7. Worker 崩溃后具体发生什么？

租约默认 12 秒，正常 Worker 约每 4 秒续租。进程崩溃后不再续租；下一次轮询时，
过期 Run 被条件更新回 `queued`，清空 worker_id 和 lease。新 Worker 领取后
`attempt_count` 从 1 变成 2，并写入 `job.recovered` 事件。因此恢复过程是可查询、
可回放的。

### 8. 为什么同时保存 Run 当前状态和 append-only 事件？

Run 表保存当前物化状态，便于快速查询列表和筛选；RunEvent 保存每次模型、检索、
工具和审批步骤，支持审计、SSE 推送、问题定位与回放。两类数据分别服务“当前查询”
和“历史证据”。

### 9. SSE 如何工作？

浏览器连接 `/api/runs/{id}/stream`。服务端每 350ms 查询 Run 和事件，在状态、
事件数量、最后事件 ID 或 attempt_count 变化时发送 `snapshot`；无变化时定期发送
keepalive，结束状态发送 `done`。实现简单，适合当前 MVP；大规模时可以换成 Redis
Pub/Sub 或消息总线驱动推送。

### 10. 为什么选择数据库队列而不是直接上 Kafka/Redis？

当前重点是证明任务状态机和恢复语义，数据库队列部署简单，事务与 Trace 一致，
SQLite/PostgreSQL 都能运行。高并发或低延迟分发时，再把领取与投递层替换成 Redis
Streams、SQS 或 Kafka，Run 状态机不需要重写。

## 三、工具与幂等

### 11. 工具超时重试如何实现？

统一 Tool Gateway 进行参数校验和有限次重试。当前内置工具最多 3 次尝试，演示故障
模式第一次返回超时，第二次成功，Trace 记录 attempts=2 和“已恢复”。生产环境应
根据工具类型配置超时、退避、熔断和最大预算。

### 12. 如何避免 Worker 恢复后重复退款？

调用退款时使用以 Run ID 构造的幂等 key。当前内置工具把结果保存在进程内幂等缓存；
MCP 幂等工具会从持久化的成功 `tool.completed` 事件中复用结果。这里是一个明确的
MVP 边界：生产环境应使用数据库幂等表和唯一约束，保证跨进程、跨节点重启后的
幂等性。

### 13. 为什么发布后不能修改工具绑定？

运行记录引用特定 AgentVersion。若已发布版本还能修改工具集合，同一个版本号会对应
不同行为，Trace 也无法复现。因此只有 Draft 可以修改绑定；发布后绑定冻结，新变更
需要创建新版本。

### 14. 工具参数如何校验？

每个工具声明 JSON Schema，Runtime 还会对关键参数做业务校验，例如退款订单号、
金额和原因必填，金额必须大于 0。Schema 负责结构，业务代码负责金额、权限和策略等
语义约束。

### 15. 工具错误如何进入 Trace？

每次工具调用都写 `tool.completed` 或 `tool.failed`，包含 tool、source、attempts、
latency、result/error、MCP Server 和 remote name。敏感字段在写入或返回前按名称
递归脱敏，例如 token、password、cookie、api_key。

## 四、MCP

### 16. 为什么需要 MCP Bridge？

Bridge 把传输、会话、白名单、鉴权和超时从 Runtime 中隔离出来。Runtime 只调用
统一的 Bridge API，不直接管理子进程或 HTTP MCP 客户端。这样 stdio 与
Streamable HTTP 可以共享工具发现、健康检查和调用语义。

### 17. stdio 与 Streamable HTTP 如何选择？

stdio 适合本机、受信任和生命周期由 Bridge 管理的工具；Streamable HTTP 适合独立
部署、可水平扩展或跨服务访问的 MCP Server。两种传输都被转换为相同的工具定义和
调用结果，Runtime 通过 `source=mcp` 与 server ID 审计来源。

### 18. MCP Bridge 如何降低安全风险？

当前实现包含受信任服务端配置、stdio 命令配置、工具允许列表、Bridge Token、
同源重定向策略、默认 12 秒超时、持久会话复用、5 分钟空闲回收、健康检查、敏感
字段脱敏，以及写工具审批。生产还需要 MCP OAuth、域名级出口策略和进程隔离。

### 19. MCP 返回内容能直接当指令执行吗？

不能。MCP 返回值属于不可信外部数据，只能作为事实输入或工具结果，不能覆盖系统
提示词、权限和审批策略。生产化应加入内容隔离、风险分类、来源标签和人工复核。

### 20. 如何扩展新的 MCP Server？

在 Bridge 的受信任配置中登记传输、命令或 URL、允许工具和审批工具，然后通过
Owner 接口执行发现。系统会保存工具 Schema、readOnly/destructive/idempotent
注解，并在 Draft Agent 中绑定需要的工具。

## 五、权限、多租户与 Session

### 21. 如何保证租户隔离？

Session 固定当前 tenant_id；查询 Agent、Run、Approval、MCP Server、Dataset 时
都增加 tenant_id 过滤。客户端伪造租户 Header 不会改变服务端 Session 的租户。
切换工作区也必须先验证用户存在 Membership。

### 22. Owner、Approver、Member 分别做什么？

- Owner：Agent、MCP、评测、发布和审批。
- Approver：读取数据并审批敏感操作，不能创建或发布版本。
- Member：运行 Agent、编辑 Draft、执行评测，不能审批。
- Viewer：只读。

权限通过 `require_roles` 在 API 层统一校验，而不是只靠前端隐藏按钮。

### 23. Session 如何保存，为什么比 localStorage Token 安全？

密码使用 PBKDF2-SHA256、随机盐和 210,000 次迭代。登录后生成随机 Session Token，
数据库只保存 Token 的 SHA-256 摘要，浏览器使用 HttpOnly、SameSite=Lax Cookie。
脚本无法直接读取 HttpOnly Cookie；生产 HTTPS 下还会启用 Secure。

### 24. CSRF 如何防护？

Session Cookie 使用 SameSite=Lax，同时服务端对修改请求检查 Origin。正式生产还应
结合严格 CORS、CSRF Token 和 OIDC/SSO 会话策略。

## 六、审批与状态机

### 25. 为什么审批不是前端弹窗直接执行工具？

浏览器关闭或 API 重启后，弹窗就失效。当前实现把拟调用的工具、参数和审批原因写入
数据库，Run 进入 `waiting_approval`；只有 Owner/Approver 决策后，Run 才重新入队，
由 Worker 执行。这样审批、恢复和审计都在服务端闭环。

### 26. 审批被驳回后会怎样？

Approval 变成 rejected，Run 变成 rejected 并记录原因，不执行任何写工具。Trace
会保留原请求、拟调用参数和审批决策，之后可以复盘。

### 27. 如何防止同一审批被重复处理？

当前 Approval 与 Run 一对一，并且处理前检查状态仍为 pending。生产环境建议再加
条件更新或行锁，把“pending -> approved/rejected”做成原子状态迁移，并让工具
执行使用持久幂等键，避免并发审批和恢复造成重复副作用。

## 七、评测与发布

### 28. 为什么评测不能只看准确率？

准确率高但 P95 延迟或成本失控的版本仍然不适合上线。AgentForge 同时检查最低
准确率、最高 P95 延迟和最高平均成本，只有三个指标都通过才发布。

### 29. 发布门禁如何工作？

Draft 版本在固定数据集上执行回归，生成 EvalRun 和逐个 EvalResult。系统比较阈值，
写入 ReleaseCheck 审计记录。通过时发布 Draft 并把旧 published 版本标记为
superseded；失败时保留 Draft，不替换线上版本。

### 30. 当前评测实现有什么限制？

当前由 API 进程中的 evaluation worker 同步处理，方便本地演示，但会占用请求时间，
也不适合大规模并行。生产应把评测拆成任务队列、独立 Worker、超时预算和可取消
执行，并对数据集版本、标注质量和模型波动做治理。

### 31. 真实模型接入如何保证可演示？

模型网关兼容 OpenAI Chat Completions。配置 Base URL、API Key 和模型名即可接入
DeepSeek 等兼容服务；未配置或调用失败时回退到确定性 Demo 模型，避免现场演示被
网络或额度阻塞。

## 八、可扩展性与生产化

### 32. 如何扩展到多个 Worker？

数据库条件更新或 PostgreSQL `SKIP LOCKED` 已经支持多 Worker 竞争领取；心跳和
租约负责故障回收。下一步可增加队列分区、并发上限、Worker 能力标签和 Redis
Streams 分发。

### 33. 为什么使用 SQLite 和 PostgreSQL 两种模式？

SQLite 让本地一键启动和评审成本最低；PostgreSQL 提供更接近生产的事务、并发与
容器部署能力。两者共用 SQLAlchemy 模型、Run 状态机和评测逻辑。

### 34. Trace 数据量增长怎么办？

短期可按租户和时间索引、限制查询页大小；长期应做事件归档、冷热分层、采样和保留
策略。审计要求高的租户应保留完整事件，普通调试数据可以缩短保留时间。

### 35. 下一步最优先的生产化工作是什么？

优先顺序是 OIDC/SSO、持久化幂等表、Alembic 数据库迁移、Redis/消息队列评测和
任务分发、MCP OAuth 与出口策略、pgvector 检索和完整观测告警。先补安全和数据
一致性，再做更复杂的 Agent 编排。

## 九、行为与取舍题

### 36. 这个项目最大的技术难点是什么？

最难的不是调用模型，而是让“人工审批”和“故障恢复”同时成立。审批通过后不能由
Web 请求直接执行工具，否则任务不可恢复；必须把审批当作状态迁移，把 Run 重新
入队，再由 Worker 从检查点继续，同时保证幂等和 Trace 完整。

### 37. 哪项设计如果重做，你会改变？

我会优先把工具幂等从内存缓存升级为数据库表或外部幂等服务，并把 Approval 状态
迁移改成条件更新。这样跨进程重启与并发审批的一致性更可靠，也能更早暴露生产
环境中的真实约束。

### 38. 你从这个项目学到了什么？

Agent 平台的核心不是“能调用多少工具”，而是能否对一次执行负责：失败可恢复、
权限可验证、决策可解释、版本可回滚或阻止发布。把状态、事件和权限建模正确，比
增加一个模型或页面更有价值。

## 十、答题公式

面试时使用以下结构，避免只报功能：

```text
结论：一句话说明选择或机制
原因：如果不这样做会发生什么问题
实现：关键数据结构、状态迁移或组件
证据：测试、Trace、指标或代码位置
边界：当前限制与生产化下一步
```

示例：

> 退款审批采用服务端持久化状态机。原因是直接在 Web 请求里执行写工具不可恢复，
> 也绕过了权限边界。实现上先写 Approval 和拟调用参数，Run 进入
> waiting_approval；批准后重新入队，Worker 从检查点执行。Trace 会记录审批人与
> 工具结果。当前还需把幂等缓存升级为数据库约束，才能支持更强的跨节点保证。
