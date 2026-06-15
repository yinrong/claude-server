# tunnel — 内网穿透客户端

ai-hub 的内网穿透客户端（原 `llm-router/c`）。部署在内网机器，主动出站连接 router，将内网 LLM API 透出到公网。

**注意**：tunnel 是独立组件，不由 ai-hub 的 `ecosystem.config.cjs` 管理。每台内网机器自行部署，通过 systemd user service 常驻运行。

## 工作原理

```
Claude Code / 其他客户端
        │
        │  HTTPS  /g/{group_id}/anthropic/v1/messages
        ▼
    router (公网)
        │
        │  WSS 出站  /ws/notifications
        ▼
    tunnel（内网，主动出站连接）
        │
        ▼
    内网 LLM API（如 http://10.0.0.5:8000）
```

同一 group 可在多台机器部署 tunnel，router 自动选主，仅 1 个 active 实例处理请求。

## 安装（一键）

在内网机器上执行（将地址、group_id 和 LLM 地址替换为实际值）：

```bash
curl -fsSL https://your-router.example.com:8443/install/c.sh | \
  X_BASE_URL=https://your-router.example.com:8443 \
  GROUP_ID=13800138000_home \
  INTERNAL_LLM_BASE=http://10.0.0.5:8000 \
  bash
```

安装脚本自动完成：
1. 下载代码到 `~/.llmrouter/c/`，创建 Python venv，安装依赖
2. 写入 `~/.llmrouter/c/.env`
3. 创建 `~/.llmrouter/systemd/llmrouter-c.service`
4. `loginctl enable-linger` — 用户退出后服务仍运行
5. `systemctl --user enable --now llmrouter-c` — 立即启动并设为开机自启

## 手动安装

```bash
# 克隆整个 ai-hub 仓库或只复制 tunnel/ 目录
cd tunnel
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 创建 .env
cat > .env <<EOF
X_BASE_URL=https://your-router.example.com:8443
GROUP_ID=13800138000_home
INTERNAL_LLM_BASE=http://10.0.0.5:8000
EOF

# 启动
python _server.py
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `X_BASE_URL` | router 公网地址 |
| `GROUP_ID` | 所属 group，格式 `{手机号}_{后缀}` |
| `INTERNAL_LLM_BASE` | 内网 LLM API 地址（tunnel 转发到此） |

## 自更新

tunnel 定期向 router 查询 `/api/version/c`，发现新版本后自动下载到 `~/.llmrouter/releases/` 并由 systemd 重启切换。默认 1 小时检查一次（带随机抖动）。

## 文件落地约束

tunnel 在用户机器上只写 `~/.llmrouter/` 子树：

```
~/.llmrouter/
├── c/              # 部署目录（代码 + venv）
├── cache/          # client_id.json、c-tunnel.json
├── releases/       # 自更新缓存
├── logs/
└── systemd/llmrouter-c.service
```

唯一例外：`systemctl --user link` 在 `~/.config/systemd/user/` 建软链接（systemd 自身行为）。
