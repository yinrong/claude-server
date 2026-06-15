# router — LLM 路由层

ai-hub 的 LLM API 路由服务（原 `llm-router/x`）。部署在公网服务器，承担控制面与数据面双职责：管理 group/client 注册，中继内网 LLM API 请求。

## 功能

- **WS 隧道中继** — 通过 WebSocket 将外部 LLM API 请求转发到内网 tunnel 客户端
- **多租户** — 以 `group_id`（手机号+后缀）隔离不同用户流量
- **选主** — 同一 group 可部署多个 tunnel 客户端，router 自动选主
- **审计** — 记录所有请求（时间、token 用量）到 SQLite
- **自动分发** — 向 tunnel 客户端推送版本更新，触发自更新

## 启动

### 通过 PM2（推荐，由 ecosystem.config.cjs 管理）

```bash
pm2 start ecosystem.config.cjs --only ai-hub-router
```

### 直接启动

```bash
cd router
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m x
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `X_BASE_URL` | （必填）| 本服务的公网地址，写入安装脚本供 tunnel/client 使用 |
| `X_HOST` | `0.0.0.0` | 监听地址 |
| `X_PORT` | `8443` | 监听端口 |
| `LLMROUTER_HOME` | `~/.llmrouter` | 数据根目录 |
| `X_DB_PATH` | `~/.llmrouter/data/x.sqlite` | SQLite 路径 |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/healthz` | 健康检查，返回 `{"ok":true,"version":"..."}` |
| POST | `/api/groups` | 创建 group `{phone, suffix}` → `{group_id, tunnel_secret}` |
| GET | `/api/groups?phone=` | 查询手机号下所有 group |
| GET | `/api/groups/:group_id` | 查询单个 group 详情（含 tunnel 客户端列表和在线状态）|
| POST | `/g/:group_id/anthropic/v1/messages` | LLM 请求中继（Anthropic 格式）|
| GET | `/ws/notifications` | tunnel 客户端 WS 连接入口 |
| GET | `/install/c.sh` | tunnel 安装脚本（Linux/macOS）|
| GET | `/install/a.sh` | client 配置脚本（Linux/macOS）|
| GET | `/install/a.ps1` | client 配置脚本（Windows）|
| GET | `/api/version/c` | tunnel 客户端版本查询（用于自更新）|

## 验证

```bash
curl http://localhost:8443/healthz
# → {"ok":true,"version":"0.1.0"}
```

## 测试

```bash
cd router
source venv/bin/activate
python -m pytest tests/ -v
```

## 目录结构

```
router/
├── x/                  ← 主包（HTTP 路由、sqlite、选主、审计、relay）
│   ├── relay.py        ← 多租户 WS 隧道 + API 路由
│   └── scripts/*.tmpl  ← curl 安装脚本与 systemd unit 模板
├── tests/              ← E2E 测试（无 mock，plain HTTP）
├── requirements.txt
└── README.md
```

详细协议说明见 [docs/design/ai-hub-architecture.md](../docs/design/ai-hub-architecture.md)。
