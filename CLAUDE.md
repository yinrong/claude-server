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

## Agent 类型

| 类型 | 说明 |
|------|------|
| `master` | systemPrompt 动态注入所有记忆；观察所有 Worker 对话并异步提取用户偏好 |
| `worker` | 独立 claude-code 实例，处理具体任务 |

## 关键设计决策

### ClaudeCodeAdapter 的多轮对话方案

**问题**：`claude --input-format stream-json` 对 stdin 里的每条 user 消息都会响应，直接传历史会导致 adapter 捕获到第一条历史消息的回答，后续轮次返回相同结果。

**方案**：把对话历史编码为 `--append-system-prompt`（XML 格式），stdin 只传当前新消息，claude 只响应一次。

```
claude --print --output-format stream-json --verbose \
       --dangerously-skip-permissions \
       --append-system-prompt "<conversation_history>...</conversation_history>" \
<<< "当前用户消息"
```

### Master 记忆系统

每次 Worker 完成一轮对话后，AgentManager 异步触发 Master 分析该交互，提取用户偏好写入 `memory` 表（category / key / value / confidence）。Master 下次被调用时，从 memory 表重建 systemPrompt 前缀。累计 20 条新 memory 后触发一次整合压缩。

### @dispatch 自动路由

Master 回复中若包含 `@dispatch <agentId>: <任务>` 模式，AgentManager 解析后自动将任务投递给目标 Worker，无需用户手动操作。

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agents` | 列出所有 Agent |
| POST | `/api/agents` | 创建 Agent `{name, type, adapterType, config}` |
| GET | `/api/agents/:id` | 获取单个 Agent 状态 |
| POST | `/api/files` | 上传文件 `{data: dataURL, name}` → `{fileId, url, path}` |
| GET | `/api/memory` | 获取所有用户偏好记忆 |
| GET | `/files/:filename` | 访问已上传文件 |

## WebSocket 协议 `/ws?agentId=`

**Client → Server**

```jsonc
{ "type": "msg", "agentId": "...", "content": [{"type":"text","text":"..."}] }
{ "type": "dispatch", "toAgentId": "...", "fromAgentId": "...", "content": [...] }
{ "type": "sub", "agentId": "..." }   // 订阅额外的 agent
```

**Server → Client**

```jsonc
{ "type": "history", "messages": [...] }   // 连接时回放历史
{ "type": "msg", "message": {...} }         // 用户消息确认（user/dispatch role）
{ "type": "chunk", "agentId": "...", "text": "..." }  // 流式文字块
{ "type": "done", "agentId": "...", "msgId": "..." }  // 本轮完成
{ "type": "status", "agentId": "...", "status": "running|idle|error" }
{ "type": "error", "agentId": "...", "error": "..." }
```

## 数据库 Schema

```sql
agents   (id, name, type, adapter_type, config JSON, status, created_at)
messages (id, agent_id, role, content JSON, from_agent_id, ts)
files    (id, name, path, url, mime_type, created_at)
memory   (id, category, key, value, confidence, source_agent_id, created_at, updated_at)
         UNIQUE(category, key)
```

数据库路径：`data/claude-server.db`（可通过 `DB_PATH` 环境变量覆盖，测试时用 `data/test.db`）。

## 测试

```bash
# 单元/集成 E2E（10 个测试，用 mock adapter，不调用真实 claude）
PORT=37890 npx playwright test

# UI 浏览器交互测试（2 个测试，调用真实 claude，需要 PM2 在 4280 运行）
xvfb-run --auto-servernum npx playwright test --config=playwright.smoke.config.js
```

| 测试文件 | 内容 |
|----------|------|
| `tests/e2e.test.js` | T1-T10：健康检查、Agent CRUD、WS 历史、流式响应、多端广播、持久性、文件上传、文件消息、记忆 API、Master systemPrompt |
| `tests/ui-smoke.test.js` | 完整用户流程（真实 chrome）；**回归：多轮对话答案随问题变化**（防止历史传递 bug 复现） |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4280` | 监听端口 |
| `DB_PATH` | `data/claude-server.db` | SQLite 路径（相对项目根） |
| `FILES_DIR` | `data/files` | 上传文件存储目录 |
| `CLAUDE_BIN` | `claude` | claude CLI 路径 |
