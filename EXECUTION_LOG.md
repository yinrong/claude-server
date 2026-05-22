# Claude-Server v2 执行日志

> 本文件由 AI 自动更新，用户可随时查看进度。

---

## [步骤1] 架构评估 + 决定重写
状态: ✅ 完成
做了什么: 分析旧项目（PTY 终端包装器），评估可复用性约 54% 但核心范式完全不同。决定清空重写，保留 EXECUTION_LOG.md 和 package.json 骨架。
下一步: 验证 claude CLI programmatic 接口

---

## [步骤2] 验证 claude CLI 接口
状态: ✅ 完成
做了什么:
- 确认 `@anthropic-ai/claude-code` 包是 CLI 二进制，无 JS API
- 验证 `claude --print --input-format stream-json --output-format stream-json` 正常工作
- 验证多轮对话：传入完整历史作为 stream-json events，Claude 正确理解上下文
- 验证 `--append-system-prompt` 可注入 systemPrompt（用于 Master 记忆）
选定方案: spawn claude CLI，stdin 传历史 stream-json，stdout 解析 stream-json 输出

---

## [步骤3] 清空旧代码 + 更新依赖
状态: ✅ 完成
做了什么: 删除旧 server/ public/ tests/，移除 node-pty 依赖，创建新目录结构（core/ store/ server/ public/ tests/）

---

## [步骤4] 编写 E2E 测试 T1-T10
状态: ✅ 完成
做了什么: 用 Playwright 写 10 个端到端测试，覆盖：健康检查、Agent CRUD、WS 历史、流式响应、多端广播、持久性、文件上传、文件消息、记忆 API、Master systemPrompt

---

## [步骤5] 实现 store/ + core/adapter/
状态: ✅ 完成
做了什么:
- `store/db.js`: 新 SQLite schema（agents + messages + files + memory 四张表）
- `store/files.js`: 文件/图片存储到 data/files/
- `core/adapter/base.js`: AIAdapter 抽象基类
- `core/adapter/mock.js`: Mock 适配器（echo，用于测试）
- `core/adapter/claude-code.js`: Claude Code 适配器（spawn CLI，stream-json I/O）

---

## [步骤6] 实现 core/agent-manager.js
状态: ✅ 完成
做了什么:
- Agent 注册表（Map<id, {config, adapter, subscribers}>）
- `sendMessage()`: 保存消息 → 调用 adapter → 流式广播 chunks → 保存 assistant 响应
- `@dispatch` 正则解析：Master 输出含 `@dispatch <agentId>: <task>` 时自动转发
- 跨 Agent 记忆分析：每次 Worker 完成对话，触发 Master 异步分析用户偏好
- 动态 systemPrompt：Master 每次发消息前，从 memory 表重建 systemPrompt
- `restoreFromDB()`: 服务重启时从 DB 恢复所有已创建 Agent

---

## [步骤7] 实现 server/ (HTTP + WebSocket)
状态: ✅ 完成
做了什么:
- `server/api/agents.js`: GET/POST/DELETE /api/agents
- `server/api/files.js`: POST /api/files
- `server/ws.js`: WebSocket 处理（sub/msg/dispatch 三种消息类型）
- `server/index.js`: Express + WS 入口，/api/memory 端点，/files 静态文件服务

---

## [步骤8] 实现前端聊天 UI
状态: ✅ 完成
做了什么:
- `public/index.html`: 聊天式 UI，Sidebar 显示所有 Agent，主区域显示对话气泡
- `public/app.js`: WS 管理、流式渲染（streaming bubble）、图片粘贴、文件附加、派发 Modal、记忆面板
- `public/style.css`: Catppuccin Mocha 主题，响应式，Mobile 支持

---

## [步骤9] PM2 配置 + 全量验收
状态: ✅ 完成
做了什么: ecosystem.config.cjs（PORT=4280），10/10 E2E 测试通过（3.8s），pm2 start + pm2 save
测试结果: **10/10 PASS** ✅

---

## 最终状态

| 功能 | 状态 | 实现 |
|------|------|------|
| 图片/文件粘贴和显示 | ✅ | clipboard API → base64 → /api/files → inline img + 文件预览 |
| 服务端持续运行 | ✅ | PM2 管理，Agent 与 WS 生命周期解耦，断线后自动重连 |
| 自主探索不询问 | ✅ | `--dangerously-skip-permissions` flag in ClaudeCodeAdapter |
| 多端同时控制 | ✅ | Map<agentId, Set<ws>> 广播，手机/PC 同时连接同一 Agent |
| Master 记忆系统 | ✅ | Worker 对话后异步提取偏好 → memory 表 → Master systemPrompt 动态注入 |
| @dispatch 自动路由 | ✅ | 正则解析 Master 输出，自动转发任务给目标 Worker |
| 可插拔 AI 适配器 | ✅ | AIAdapter 抽象基类，已实现 ClaudeCodeAdapter + MockAdapter |

## 服务地址
- Web UI: http://localhost:4280
- API 列表: http://localhost:4280/api/agents
- 记忆查看: http://localhost:4280/api/memory
- PM2 日志: `pm2 logs claude-server`

## 文件结构
```
claude-server/
├── core/
│   ├── agent-manager.js      # 编排核心：消息路由、@dispatch、记忆分析
│   └── adapter/
│       ├── base.js           # AIAdapter 抽象基类
│       ├── mock.js           # Mock 适配器（测试）
│       └── claude-code.js    # Claude Code CLI 适配器
├── store/
│   ├── db.js                 # SQLite（agents+messages+files+memory）
│   └── files.js              # 文件存储
├── server/
│   ├── index.js              # Express + WS 入口
│   ├── api/agents.js         # Agent CRUD + memory
│   ├── api/files.js          # 文件上传
│   └── ws.js                 # WebSocket 处理
├── public/                   # 前端 UI（聊天气泡，无 xterm）
├── tests/e2e.test.js         # 10 个 E2E 测试
├── data/claude-server.db     # SQLite 数据库
├── EXECUTION_LOG.md          # 本文件
├── ecosystem.config.cjs      # PM2（PORT=4280）
└── package.json
```

## 使用第一步
1. 打开 http://localhost:4280
2. 点 ＋ 创建一个 **Master** agent（adapter 选 claude-code，cwd 选你的项目目录）
3. 再创建若干 **Worker** agent
4. 对 Master 说话，它会自动学习你的偏好
5. Master 的回复中可写 `@dispatch <worker-agent-id>: <任务>` 自动派发给 Worker
