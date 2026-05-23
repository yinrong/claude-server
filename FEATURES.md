# Feature List

> 本文件是项目功能的 single source of truth。每次需求变动必须同步更新。
> 每个功能都必须有对应的 E2E 回归测试。

---

## 核心功能

| # | 功能 | 说明 | 测试覆盖 |
|---|------|------|---------|
| C1 | 多 Agent 管理 | 创建/列出/查看 Agent（Master/Worker） | T2 |
| C2 | PTY 交互模式 | 完整 claude-code 交互，支持所有 slash commands | ui-smoke:完整用户流程 |
| C3 | 服务端持久运行 | Agent 进程不受客户端断开影响，PM2 管理 | T6 |
| C4 | 多端同时控制 | 同一 Agent 多个 WS 客户端同时连接，输出广播 | T5 |
| C5 | 断线重连回放 | 客户端重连后自动回放最近 output buffer | T3 |
| C6 | 多轮对话上下文 | 对话历史正确传递，不同问题得到不同回答 | ui-smoke:回归多轮对话 |

## 文件/图片

| # | 功能 | 说明 | 测试覆盖 |
|---|------|------|---------|
| F1 | 文件上传 | POST /api/files 上传 base64 文件 | T7 |
| F2 | 文件消息 | 消息中引用 fileId，存储+广播 | T8 |
| F3 | 图片粘贴 | Ctrl+V 粘贴图片 → 上传 → 路径注入 PTY | ui-smoke:完整用户流程 |
| F4 | 文件选择器 | 📎 按钮选文件 → 上传 → 路径注入 PTY | ui-smoke:完整用户流程 |

## Master 记忆系统

| # | 功能 | 说明 | 测试覆盖 |
|---|------|------|---------|
| M1 | 记忆 API | GET /api/memory 返回所有偏好记忆 | T9 |
| M2 | Master systemPrompt | Master 的 config 中动态注入 memory 内容 | T10 |
| M3 | @dispatch 自动路由 | Master 输出含 @dispatch agentId: task 时自动转发 | (待补) |
| M4 | 跨 Agent 对话分析 | Worker 完成对话后异步分析用户偏好 | (待补) |

## UI / 响应式

| # | 功能 | 说明 | 测试覆盖 |
|---|------|------|---------|
| U1 | xterm.js 终端渲染 | 完整 ANSI 颜色、进度条、diff 显示 | ui-smoke:完整用户流程 |
| U2 | 移动端侧栏收起 | ☰ 汉堡菜单，点击展开/收起 | (手动验证) |
| U3 | 底部输入栏 | 独立 textarea，Enter 发送，适配手机键盘 | (手动验证) |
| U4 | 自适应终端尺寸 | fitAddon 自动调整 cols/rows，resize 通知 PTY | (手动验证) |
| U5 | 新建 Agent 弹窗 | Modal 表单创建 Agent（点空白不关闭，ESC/取消才关） | ui-smoke:完整用户流程 |
| U6 | 右键删除 Agent | Sidebar 右键菜单确认删除 + kill PTY | T11 |
| U7 | 目录浏览器 | 新建 Agent 时可点击浏览服务器目录 | T12 |
| U8 | Agent 等待输入状态 | 左侧列表显示 ⏳ 等待输入（PTY 2 秒无输出触发） | T13 |

## 适配器层

| # | 功能 | 说明 | 测试覆盖 |
|---|------|------|---------|
| A1 | AIAdapter 抽象基类 | 事件驱动接口 (data/exit/write/resize/stop/restart) | T4 |
| A2 | ClaudeCodeAdapter | 持久 PTY 进程，--dangerously-skip-permissions | T4, ui-smoke |
| A3 | MockAdapter | 测试用 echo 适配器 | T1-T10 |

## 基础设施

| # | 功能 | 说明 | 测试覆盖 |
|---|------|------|---------|
| I1 | HTTP API | /api/agents, /api/files, /api/memory | T1, T2, T7, T9 |
| I2 | WebSocket 协议 | /ws?agentId= 连接，input/resize/output/history | T3-T5 |
| I3 | SQLite 持久化 | agents, output_buffer, files, memory 四张表 | T2-T10 |
| I4 | PM2 进程管理 | ecosystem.config.cjs, prod(4280) + dev(4281) | (部署验证) |
| I5 | 多环境隔离 | prod/dev 用不同端口+不同 DB，代码更新只重启 dev | T14 |

---

## 待开发 / 计划中

| # | 功能 | 说明 | 优先级 |
|---|------|------|--------|
| ~~P1~~ | ~~右键删除 Agent~~ | ✅ 已实现 → U6 | |
| ~~P2~~ | ~~目录浏览器~~ | ✅ 已实现 → U7 | |
| ~~P3~~ | ~~新建弹窗点击空白不关闭~~ | ✅ 已实现 → U5 | |
| ~~P4~~ | ~~Agent 等待输入状态~~ | ✅ 已实现 → U8 | |
| ~~P5~~ | ~~多环境 (dev/prod)~~ | ✅ 已实现 → I5 | |
| P6 | 切换工作目录 | toolbar 按钮，退出 claude 重新 cd && claude | 中 |
| P7 | 记忆常用启动命令 | 自动记录最近使用的 cwd + 命令 | 中 |
| P8 | @dispatch E2E 测试 | 自动路由的端到端验证 | 低 |
| P9 | 跨 Agent 分析 E2E | 对话分析 + 记忆写入验证 | 低 |
