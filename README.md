# ai-hub

多 Agent 编排与 LLM 路由平台。统一管理多个 claude-code 实例，内置 LLM API 路由层和内网穿透，支持手机和桌面同时控制。

## 组件

| 组件 | 语言 | 说明 |
|------|------|------|
| [server/](./server/) | Node.js | Agent 编排服务，管理 PTY/stream 进程，WebSocket + REST API |
| [router/](./router/) | Python (aiohttp) | LLM API 路由层（原 llm-router/x），含 WS 隧道中继、多租户、审计 |
| [llm/](./llm/) | Python | LLM 访问包（原 llm-api），统一封装 OpenAI/Anthropic 双后端 |
| [tunnel/](./tunnel/) | Python | 内网穿透客户端（原 llm-router/c），独立部署在内网机器 |
| [web/](./web/) | HTML/JS | PC Web 客户端，PTY 终端 + Chat 气泡双 UI |
| [mobile/](./mobile/) | Flutter | 手机客户端（开发中） |

## 快速启动

```bash
# 安装 Node.js 依赖
npm install

# 一键启动所有进程（proxy + prod + prev + dev + router）
pm2 start ecosystem.config.cjs
pm2 save

# 验证
curl http://localhost:4280/api/health   # server
curl http://localhost:8443/healthz      # router（如已启动）
```

打开 `http://localhost:4280`，点 **＋** 创建第一个 Agent。

## 环境隔离

| 环境 | 端口 | DB | PM2 名 | 用途 |
|------|------|-----|--------|------|
| prod | 4280 | data/prod.db | claude-server-prod | 稳定运行，不能随便重启 |
| prev | 4281 | data/prev.db | claude-server-prev | 上一个稳定版，回退用 |
| dev | 4282 | data/dev-next.db | claude-server-dev | 开发测试，随时重启 |
| router | 8443 | ~/.llmrouter/data/x.sqlite | ai-hub-router | LLM 路由层 |
| test | 37890 | data/test.db | (自动启停) | Playwright E2E 专用 |
| smoke | 37891 | data/smoke-test.db | (自动启停) | UI smoke 测试 |

**规则**：代码更新只重启 dev。绝不能 `pm2 delete all`。

## 开发

```bash
# 只启动/重启 dev（不影响 prod）
pm2 restart claude-server-dev

# 运行 server E2E 测试（独立端口 37890 + 独立 DB）
npm test

# 运行 router 测试（需先启动 router 进程）
cd router && python -m pytest tests/ -v

# 运行 smoke 测试（调用真实 claude）
xvfb-run --auto-servernum npx playwright test --config=playwright.smoke.config.js
```

## 架构文档

- [CLAUDE.md](./CLAUDE.md) — 完整架构、设计决策、API 参考（AI 阅读）
- [FEATURES.md](./FEATURES.md) — 功能清单 + 测试覆盖状态（DDD 真相来源）
- [docs/design/ai-hub-architecture.md](./docs/design/ai-hub-architecture.md) — 整合设计方案

## 各组件文档

- [router/README.md](./router/README.md) — LLM 路由层说明
- [tunnel/README.md](./tunnel/README.md) — 内网穿透客户端说明
- [llm/README.md](./llm/README.md) — LLM 访问包说明
