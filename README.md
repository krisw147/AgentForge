# AgentForge

AgentForge 是一个可本地运行的 Agent Runtime 与 AgentOps 控制台示例，面向 AI 应用开发、Agent 平台和 LLMOps 岗位的作品集展示。

它不只演示“模型能回答”，还完整展示一次运行如何经过意图识别、知识检索、工具权限、故障重试、人工审批、检查点恢复、Trace 回放和版本评测。

作品集文档：

- [架构设计](docs/ARCHITECTURE.md)
- [5 分钟演示脚本](docs/DEMO_SCRIPT.md)
- [项目复盘与简历描述](docs/PORTFOLIO_CASE_STUDY.md)

## 当前功能

- Agent 注册表、版本管理和系统提示词管理
- SQLite 本地持久化或 PostgreSQL 容器部署
- 数据库任务队列、独立 Runtime Worker、租约与心跳
- Worker 异常后的租约过期回收和自动恢复
- SSE 实时事件流，Playground 无需刷新即可查看执行过程
- FastAPI 服务器端 Session、HttpOnly Cookie 和密码哈希
- 多工作区 Membership、租户隔离及 Owner/Member/Approver RBAC
- Draft 版本只能在准确率、P95 延迟和成本全部达标后发布
- 发布门禁审计记录，阻止发布的版本不会替换线上版本
- MCP Server 注册表、工具发现、Schema 持久化和只读/审批策略导入
- Draft 版本可绑定内置或 MCP 工具，发布后冻结绑定
- Worker 优先路由到已绑定的 MCP 工具，并记录来源与 Server 信息
- MCP Bridge 持久会话、空闲回收、健康检查和自动重连
- 同时支持 stdio 与 Streamable HTTP MCP Server
- MCP 敏感字段自动脱敏、通用写工具审批和 Draft 工具过滤
- OpenAI 兼容模型网关，默认可离线使用确定性 Demo 模型
- 词法检索知识库，回答基于退款政策文档
- JSON Schema 工具注册与统一 Mock 工具网关
- 工具超时注入、重试与恢复事件
- 退款等敏感操作的人工审批和检查点暂停
- 审批后从持久化状态继续执行
- 完整运行 Trace、耗时、Token、成本和事件载荷
- 运行重放、工作区隔离和默认租户过滤
- 测试集管理、版本回归、准确率/P95 延迟/平均成本统计
- 响应式 Next.js 控制台

## 快速启动

### 环境要求

- Python 3.8 或更高版本
- Node.js 20 或更高版本
- npm 10 或更高版本

### 1. 安装 Python 依赖

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps\api\requirements.txt
```

### 2. 安装前端依赖

```powershell
npm install --prefix apps/web
```

### 3. 启动前后端

```powershell
npm run dev
```

打开：

- 控制台：http://localhost:3000
- API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/health

首次启动会自动创建数据库和演示数据，包括两个租户、两个 Agent、版本历史、运行记录、待审批操作和评测结果。

登录页：http://localhost:3000/login

演示账号密码统一为 `demo1234`：

| 账号 | 角色 | 权限 |
|---|---|---|
| `lin@forward.tech` | Owner | 全部权限，可切换两个工作区 |
| `chen@forward.tech` | Approver | 查看和批准敏感操作 |
| `zhou@forward.tech` | Member | 运行、编辑和评测，不可审批 |
| `qing@greenleaf.cn` | Owner | 青禾零售工作区 |

演示密码只适用于本地作品集环境。公网部署前应替换为正式身份提供商和企业 SSO/OIDC。

`npm run dev` 会同时启动 Web、API 和 Worker。需要演示 Worker 故障恢复时，可以分开启动：

```powershell
# 终端 1：Web + API，不启动 Worker
npm run dev:main

# 终端 2：独立 Worker
npm run dev:worker
```

## 推荐演示流程

1. 在 Playground 选择“退款运营助手 · v1.1.0”
2. 输入：`订单 ORD-2026-1042 的耳机不合适，我要申请退款。`
3. 选择“首次工具超时”，运行 Agent
4. 展开 Trace，展示订单工具第一次超时、第二次恢复
5. 选择“慢工具（8 秒）”并停止 Worker，再重新执行 `npm run dev:worker`
6. 展示租约过期、任务重新入队和 `job.recovered` 事件
7. 打开运行详情，在审批备注中填写说明并批准
8. 展示审批后重新入队、退款工具执行、退款单号和完成事件
9. 创建新的 Draft 版本，在版本页点击“评测并发布”
10. 选择回归集，设置准确率、P95 延迟和平均成本门槛
11. 展示通过门禁后新版本上线，以及旧版本自动标记为 superseded
12. 将 P95 门槛设得过低，展示发布被阻止且 Draft 仍不上线
13. 在 Draft 工具页绑定 MCP 订单与退款工具，完成发布
14. 运行订单查询，在 Trace 中查看 `source: mcp`
15. 发起退款，Approver 批准后由 MCP 工具完成退款
16. 回到评测中心，对比不同版本的准确率、P95 延迟和平均成本

其他可演示请求：

```text
帮我查一下订单 ORD-2026-1088 现在是什么状态？
超过 7 天的商品还能无理由退款吗？
商品包装破损，请帮我创建优先工单。
```

## 接入真实模型

复制 `.env.example` 为 `.env`，填写 OpenAI 兼容接口：

```dotenv
AGENTFORGE_LLM_BASE_URL=https://your-provider.example/v1
AGENTFORGE_LLM_API_KEY=your-key
AGENTFORGE_LLM_MODEL=your-chat-model
AGENTFORGE_LLM_EMBEDDING_MODEL=your-embedding-model
AGENTFORGE_LLM_TRUST_ENV=false
```

重启 API 后，模型网关会自动从 `demo-deterministic` 切换到真实模型。未配置或调用失败时会自动回退到确定性回答，因此不会阻塞本地演示。

`AGENTFORGE_LLM_TRUST_ENV` 默认关闭，表示模型请求不继承系统中的代理环境变量。如果部署环境必须通过显式 HTTP 代理访问模型服务，可以将其设置为 `true`。

凭据只从环境变量读取，不要提交 `.env` 文件。

## 架构

```text
Next.js 控制台
      |
FastAPI 控制面
      |
Session Cookie → Membership + RBAC
      |
SQLAlchemy 持久化任务与事件
      |
独立 Runtime Worker
  ├─ 意图与策略路由
  ├─ 知识库检索
  ├─ Tool Gateway
  ├─ 重试与故障注入
  ├─ 人工审批检查点
  └─ Trace 与评测
```

SQLite 本地模式与 PostgreSQL Docker 模式共用同一套 Worker 逻辑。Worker 通过数据库原子领取任务，写入租约和心跳；进程异常退出后，过期任务会自动回到队列。

核心代码：

- `apps/api/app/services/job_queue.py`：原子领取、租约、心跳和过期任务恢复
- `apps/api/app/worker.py`：独立 Worker 循环、异常重试和检查点恢复
- `apps/api/app/auth.py`：密码哈希、Session、Membership 和角色校验
- `apps/api/app/main.py`：评测执行、发布门禁和 ReleaseCheck 审计
- `apps/api/app/services/mcp_bridge.py`：MCP Bridge 客户端与鉴权调用
- `apps/api/app/services/runtime.py`：运行状态机、审批暂停/恢复、事件记录
- `apps/api/app/services/tools.py`：工具注册后的执行、超时注入和重试
- `apps/api/app/services/retrieval.py`：知识库检索
- `apps/api/app/services/model_gateway.py`：OpenAI 兼容模型适配与回退
- `apps/api/app/main.py`：API、租户隔离、审批和评测
- `apps/web/app/playground/page.tsx`：Agent 交互实验台
- `apps/api/tests/test_api.py`：运行、审批、隔离和评测回归测试

## 测试

```powershell
npm run test:api
npm run test:web
npm run build
npm run smoke
```

`npm run smoke:run` 会额外创建一次真实模型运行，适合部署后验证 Worker、模型和 MCP 调用链路。

当前测试覆盖：

- 服务健康与 Dashboard 数据
- 运行任务进入队列并由独立 Worker 领取
- 未登录接口返回 401，伪造租户 Header 无法切换工作区
- 多工作区 Membership 与跨租户数据隔离
- Member 无法查看或执行审批，Approver 可以审批
- Session Cookie 使用 HttpOnly 和 SameSite=Lax
- 过期 Session 失效及 CSRF Origin 检查
- Draft 创建、发布门禁通过、线上版本替换
- 指标不达标时阻止发布并保留 Draft
- Approver 无权发布 Agent 版本
- Owner 可注册 MCP Server 并导入 4 个发现工具
- Member 可查看 MCP 工具但不能刷新注册表
- MCP 工具 Schema、只读标记和敏感审批策略正确持久化
- Draft 工具绑定保存，已发布版本禁止修改
- Worker 优先调用绑定的 MCP 工具并写入 `source/mcpServerId`
- MCP 通用写工具审批和敏感输出脱敏
- Bridge 持久会话、ping 健康检查与 Streamable HTTP
- Draft 克隆时过滤已停用 MCP 工具
- MCP 退款在审批通过后继续执行
- 退款工具超时、重试和审批暂停
- 审批通过后恢复并执行退款
- 审批驳回后不触发退款工具
- Worker 租约过期后自动恢复运行
- SSE 返回实时快照与完成事件
- 不同租户的运行数据隔离
- 政策问题分类
- 同版本 8 条用例的自动回归

## Docker 部署

```powershell
docker compose up --build
```

容器模式使用 PostgreSQL 持久化。默认演示配置：

- Web：http://localhost:3000
- API：http://localhost:8000
- PostgreSQL：容器内部 `db:5432`

在公网部署前，应替换 Compose 中的演示数据库密码，并配置 HTTPS、密钥托管、正式身份认证和备份。

生产容器配置：

```powershell
Copy-Item .env.production.example .env.production
# 填写域名、数据库密码、MCP Token 和模型密钥
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

生产配置包含 Caddy 自动 HTTPS，对外只暴露 `80/443`。部署前需要将 `PUBLIC_HOST` 的 DNS 指向服务器。

## MCP 开发基础

当前已包含一个本地订单 MCP Server 和通用 MCP Bridge：

```text
mcp-servers/order-server   官方 TypeScript SDK 实现的 stdio MCP Server
mcp-servers/order-bridge   持久连接、工具发现、Token 鉴权和白名单调用桥接
```

单独验证：

```powershell
npm --prefix mcp-servers/order-server test
npm --prefix mcp-servers/order-bridge test
```

`npm run dev` 会自动启动 MCP Bridge，并向 API 与 Worker 注入同一个临时 Token。Owner 可在工具仓库导入并刷新 MCP 工具，开发者可在 Draft 版本中绑定这些工具。

本地同时运行两个传输示例：

- `order-server`：stdio，由 Bridge 管理子进程
- `order-http-server`：Streamable HTTP，独立监听 `8766`

工具仓库可为已注册 Server 执行健康检查，Bridge 会复用 MCP Client 会话并自动清理 5 分钟未使用的连接。

## 当前边界

这是可完整演示的 MVP，仍不应直接作为生产系统：

- 当前使用本地账号密码认证，下一步应接入企业 OIDC/SSO 和多因素认证
- 当前 Worker 使用数据库轮询；高并发部署可增加 Redis Streams 或消息队列作为分发层
- 当前检索为词法检索，后续可在检索服务中替换为 pgvector 向量召回与重排
- MCP 工具仍连接本地演示订单服务；远程 MCP OAuth、授权回调和域名级网络策略将在后续阶段接入
- SQLite 和 `create_all` 适用于本地演示；生产环境应使用数据库迁移工具

这些边界是有意保留的面试讨论点：项目已经证明核心产品闭环，生产化升级路径也清晰可讲。
