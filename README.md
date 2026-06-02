# Claude Hub

多 Agent 编排服务，管理多个 [Claude Code](https://github.com/anthropics/claude-code) 实例。手机和桌面同时通过 Web UI 控制。

## 功能

- **完整交互模式** — 所有 slash commands 可用（`/resume`、`/compact`、`/clear`）
- **多 Agent** — Master + N Workers，Master 可 @dispatch 派发任务给 Worker
- **手机友好** — 虚拟按键栏（Enter/Esc/Tab/方向键/Ctrl+C），响应式布局
- **持久运行** — 关闭浏览器后 Agent 继续运行，重连自动回放历史
- **多端同控** — 手机和 PC 同时连接同一 Agent，输出实时同步
- **图片/文件** — 粘贴或选择文件，路径注入 PTY
- **记忆系统** — Master 从 Worker 对话中学习用户偏好

## 快速启动

```bash
# 安装依赖
npm install

# 启动（生产 :4280，开发 :4281）
pm2 start ecosystem.config.cjs

# 或直接运行
PORT=4280 node server/index.js
```

打开 `http://localhost:4280`，点 **＋** 创建第一个 Agent。

## 开发

```bash
# 只启动 dev（不影响 prod）
pm2 start ecosystem.config.cjs --only claude-server-dev

# 运行 E2E 测试（独立端口 37890 + 独立 DB，不影响任何环境）
npm test

# 运行手机 UI 测试
npx playwright test tests/mobile.test.js

# 运行 smoke 测试（调用真实 claude，使用独立 test 环境）
xvfb-run --auto-servernum npx playwright test --config=playwright.smoke.config.js
```

## 架构文档

- [CLAUDE.md](./CLAUDE.md) — 完整架构、设计决策、API 参考
- [FEATURES.md](./FEATURES.md) — 功能列表 + 测试覆盖状态

## 环境隔离

| 环境 | 端口 | DB | PM2 名 | 用途 |
|------|------|-----|--------|------|
| prod | 4280 | data/prod.db | claude-server-prod | 稳定运行，不能随便重启 |
| dev | 4281 | data/dev.db | claude-server-dev | 开发测试，随时重启 |
| test | 37890 | data/test.db | (自动启停) | Playwright E2E 测试专用 |

**规则**：代码更新只重启 dev。绝不能 `pm2 delete all`。
