# ai-hub 架构整合设计

## Context

当前三个独立项目需要整合为统一的 `ai-hub`：
- `claude-server`：Web UI 管理多个 claude-code 实例，PTY/stream 适配层
- `llm-router`：LLM API 隧道穿透服务（X-C 架构），含多用户路由层
- `llm-api`：Python 包，统一封装 OpenAI/Anthropic 后端，claude-code CLI 通过它访问 LLM

整合后三者成为 ai-hub 的组件，共享一个 FEATURES.md、一套 E2E 测试体系、一个 ecosystem.config.cjs。

---

## 目标架构

```
ai-hub/
├── server/          ← Node.js 服务（原 claude-server/server）
├── router/          ← LLM 路由层（原 llm-router/x，Python aiohttp）
├── llm/             ← LLM 访问层（原 llm-api/llm_api，Python 包）
├── tunnel/          ← 内网穿透客户端（原 llm-router/c，独立可安装）
├── web/             ← PC Web 客户端
├── mobile/          ← Flutter 手机客户端
├── ecosystem.config.cjs
├── FEATURES.md      ← 所有组件的功能清单（DDD 唯一真相来源）
├── CLAUDE.md
└── README.md
```

**router**：独立 Python 进程，PM2 管理，REST API 与 server 协作。多用户（手机号+密码）在 server 层认证，router 负责流量路由和 WS 隧道。

**llm**：配置从硬编码改为环境变量，由 ecosystem.config.cjs 注入。

**tunnel**：独立可安装组件，不由 ai-hub 管理进程生命周期，内网机器自行部署。

---

## 架构决策

### router 与 server 的关系

- router 作为独立 Python 进程运行，PM2 管理
- server 通过 REST API 与 router 协作（`/api/groups` 等）
- 多用户认证（手机号+密码）在 server 层实现，router 负责流量路由和 WS 隧道
- DB：router 与 server 共享同一个 SQLite 文件

### llm 层配置

- 原 `llm/_conf.py` 硬编码改为从环境变量读取（`LLM_BASE_URL`、`LLM_API_KEY`）
- ecosystem.config.cjs 负责注入环境变量
- 支持多 provider：通过 `provider` 参数区分（`get_llm(provider='mify')`）

### tunnel 独立性

- 不在 ai-hub 主进程中运行
- 打包为独立可安装组件，内网机器自行部署
- ai-hub 不管理 tunnel 进程生命周期

---

## 已确认决策

| 项 | 决策 |
|----|------|
| 原 `~/llm-router` 和 `~/llm-api` 迁入后 | 保留不删除 |
| router DB 与 server DB | 合并为同一个 SQLite 文件 |
| PM2 进程名 | 统一改为 `ai-hub-*` |
| 本机部署 | 不重新部署，代码改好后 push 到新 GitHub 项目 `ai-hub` |
