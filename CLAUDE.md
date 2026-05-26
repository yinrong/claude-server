# claude-server

多 Agent 编排中枢。以 Web UI 统一管理多个 claude-code 实例，支持图片/文件、多端同时控制、Master 自动学习用户偏好并通过 `@dispatch` 派发任务给 Worker。

## 快速启动

```bash
pm2 start ecosystem.config.cjs   # 启动服务（PORT=4280）
pm2 logs claude-server            # 查看日志
```

打开 http://localhost:4280，点 **＋** 创建第一个 Agent。

## 架构

```
Browser A (PC) / Browser B (手机)
         │ WebSocket /ws?agentId=
         ▼
server/index.js  ──  server/ws.js
         │
core/agent-manager.js          ← 编排核心
  ├── Map<agentId, {adapter, subscribers}>
  ├── sendMessage()             ← 消息路由 + 广播
  ├── @dispatch 解析            ← Master 自动派发给 Worker
  └── _analyzeExchange()        ← 异步提取用户偏好到 memory 表
         │
core/adapter/
  ├── base.js                   ← AIAdapter 抽象基类
  ├── claude-code.js            ← spawn claude CLI（系统提示注入历史）
  └── mock.js                   ← 测试用 echo 适配器
         │
store/
  ├── db.js                     ← SQLite（agents / messages / files / memory）
  └── files.js                  ← 文件/图片落盘（data/files/）

public/                         ← 纯静态前端（无构建步骤）
  ├── index.html
  ├── app.js                    ← WS 客户端、聊天渲染、图片粘贴
  └── style.css                 ← Catppuccin Mocha 主题
```

查看所有 API 路由：`grep -rn "app\.\|router\." server/ | grep -E "\.(get|post|put|patch|delete)\("`

## Agent 类型

| 类型 | 说明 |
|------|------|
| `master` | systemPrompt 动态注入所有记忆；观察所有 Worker 对话并异步提取用户偏好 |
| `worker` | 独立 claude-code 实例，处理具体任务 |

## 核心架构要求（用户原始需求）

### 中间层架构（最重要的设计约束）

服务端不是 Browser↔PTY 的简单管道。它是一个**中间层**，拦截所有 I/O，具备全局视角：

```
Browser ↔ WebSocket ↔ 中间层(Server) ↔ Adapter ↔ claude-code / 其他工具
                           │
                    ┌──────┼──────┐
                    │      │      │
              路由消息  提取记忆  状态监控
```

中间层的职责：
1. **集中所有输入输出** — 一切对话都经过服务端，服务端有全局视角，可做统一控制
2. **让 Master 感知 Hub 内所有 Agent** — Master 通过服务端 API 查看其他 Agent 的状态和最近输出（而非去找机器上的 tmux 进程）
3. **让 Master 控制 Worker** — Master 可通过服务端向任意 Worker 注入消息
4. **从对话中提取记忆** — 观察 Worker 输出，检测一轮对话完成，异步分析用户偏好
5. **Worker 可替换** — 底层 Worker 可以是 claude-code、openai、gemini 或任何工具，替换不影响上层

### Master 的角色

"指定其中一个 claude-code 具备我的记忆，代替我控制其他 claude-code"：
- Master 持有用户的偏好记忆（systemPrompt 动态注入）
- Master 能查询所有 Worker 的工作目标和当前状态
- Master 能代替用户向 Worker 下达指令和反馈
- Master 能监督 Worker 不间断运行直到完成目标

### 用户对功能的根本要求

1. **完整 claude-code 功能** — 所有 slash commands（/resume, /compact, /clear）必须可用，不能用 --print 模式
2. **服务端持续运行** — 不受客户端关闭影响
3. **多端同时控制** — 手机和 PC 同时随意在某一端控制
4. **图片/文件/文字** — 多模态支持
5. **持续探索不停下** — Agent 自主工作，不停下询问用户（--dangerously-skip-permissions + 自主循环）
6. **Worker 可替换** — 接口层抽象，未来适配其他工具

---

## 关键设计决策

### 为什么用 PTY 交互模式而非 `--print`

**问题**：`--input-format stream-json` 和 `--output-format stream-json` 都 "only works with --print"。但 `--print` 模式下所有 slash commands（`/resume`、`/compact`、`/clear` 等）不可用，用户发送 `/resume` 会得到 "not available in this environment" 错误。

**方案**：用 `node-pty` 启动完整交互模式的 claude 进程，保留全部功能。每个 Agent 是一个持久 PTY 会话，与客户端生命周期完全解耦。

```
pty.spawn('claude', ['--dangerously-skip-permissions'], { cwd, cols: 80, rows: 24 })
```

claude 自己管理对话历史和 session 持久化，服务端只负责 PTY I/O 转发和输出缓存。

### 多环境隔离 (dev/prod)

**问题**：代码更新后重启 server 会中断正在运行的 Agent 进程。

**方案**：prod 和 dev 用不同端口 + 不同 DB，PM2 分别管理。代码更新只重启 dev，**绝不能** `pm2 delete all` 或 `pm2 restart all`。

| 环境 | 端口 | DB | PM2 名 |
|------|------|-----|--------|
| prod | 4280 | data/prod.db | claude-server-prod |
| dev | 4281 | data/dev.db | claude-server-dev |
| test | 37890 | data/test.db | (Playwright 自动启停) |

更新代码后只执行：`pm2 restart claude-server-dev`

### Agent waitingForInput 检测

PTY 输出流中，如果 2 秒内无新数据，判定该 Agent "等待用户输入"（`waitingForInput: true`），通过 WebSocket status 事件广播给所有客户端，侧栏显示 ⏳ 图标。任何新输出立刻重置为 false。

### Master 记忆系统

每次 Worker 完成一轮对话后，AgentManager 异步触发 Master 分析该交互，提取用户偏好写入 `memory` 表（category / key / value / confidence）。Master 下次被调用时，从 memory 表重建 systemPrompt 前缀。累计 20 条新 memory 后触发一次整合压缩。

### @dispatch 自动路由

Master 回复中若包含 `@dispatch <agentId>: <任务>` 模式，AgentManager 解析后自动将任务投递给目标 Worker，无需用户手动操作。

## HTTP API

查看所有路由：`grep -rn "app\.\|router\." server/ | grep -E "\.(get|post|put|patch|delete)\("`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agents` | 列出所有 Agent |
| POST | `/api/agents` | 创建 Agent `{name, type, adapterType, config}` |
| GET | `/api/agents/:id` | 获取单个 Agent 状态 |
| DELETE | `/api/agents/:id` | 删除 Agent（kill PTY + 从 DB 移除）|
| POST | `/api/files` | 上传文件 `{data: dataURL, name}` → `{fileId, url, path}` |
| GET | `/api/memory` | 获取所有用户偏好记忆 |
| GET | `/api/browse?path=` | 浏览服务器目录（仅返回子目录） |
| GET | `/files/:filename` | 访问已上传文件 |

## WebSocket 协议 `/ws?agentId=`

**Client → Server**

```jsonc
{ "type": "input", "data": "用户键盘输入\r" }   // 直接写入 PTY stdin
{ "type": "resize", "cols": 120, "rows": 40 }    // 终端窗口尺寸变化
{ "type": "msg", "agentId": "...", "content": [{"type":"text","text":"..."}] }  // 结构化消息（含文件引用）
{ "type": "sub", "agentId": "..." }   // 订阅额外的 agent
```

**Server → Client**

```jsonc
{ "type": "history", "chunks": ["..."] }           // 连接时回放 PTY 输出缓存
{ "type": "output", "data": "..." }                // PTY 实时输出（含 ANSI）
{ "type": "status", "agentId": "...", "waitingForInput": true }  // Agent 等待输入
{ "type": "exit", "code": 0 }                      // PTY 进程退出
```

## 数据库 Schema

```sql
agents   (id, name, type, adapter_type, config JSON, status, created_at)
messages (id, agent_id, role, content JSON, from_agent_id, ts)
files    (id, name, path, url, mime_type, created_at)
memory   (id, category, key, value, confidence, source_agent_id, created_at, updated_at)
         UNIQUE(category, key)
output_buffer (id AUTO, agent_id, data TEXT, ts)  -- PTY 原始输出缓存，保留最近 5000 条/agent
```

数据库路径：`data/claude-server.db`（可通过 `DB_PATH` 环境变量覆盖，测试时用 `data/test.db`）。

## 测试

```bash
# 单元/集成 E2E（14 个测试，用 mock adapter，不调用真实 claude）
PORT=37890 npx playwright test

# UI 浏览器交互测试（2 个测试，调用真实 claude，需要 PM2 在 4280 运行）
xvfb-run --auto-servernum npx playwright test --config=playwright.smoke.config.js
```

| 测试文件 | 内容 |
|----------|------|
| `tests/e2e.test.js` | T1-T14：健康检查、Agent CRUD、WS 历史、流式响应、多端广播、持久性、文件上传、文件消息、记忆 API、Master systemPrompt、**删除 Agent、目录浏览、waitingForInput 状态、多环境隔离** |
| `tests/ui-smoke.test.js` | 完整用户流程（真实 chrome）；**回归：多轮对话答案随问题变化**（防止历史传递 bug 复现） |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4280` | 监听端口 |
| `DB_PATH` | `data/claude-server.db` | SQLite 路径（相对项目根） |
| `FILES_DIR` | `data/files` | 上传文件存储目录 |
| `CLAUDE_BIN` | `claude` | claude CLI 路径 |
