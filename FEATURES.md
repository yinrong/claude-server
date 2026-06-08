# Feature List

> 本文件是项目功能的 single source of truth。每次需求变动必须同步更新。
> 每个功能都必须有对应的 E2E 回归测试。

状态：✅ 测试通过 | ⚠️ 已实现未测试 | ❌ 失效/Bug | 🔲 未实现

---

## 1. 核心架构

### 1.1 中间层 Server

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| C1 | 中间层架构 | /summary /summaries /inject API 形成中间层 | ✅ | T19,T20,T21 |
| C2 | Master 感知 Hub Agents | GET /api/agents/summaries 返回所有 Agent 输出 | ✅ | T20 |
| C3 | Master 代替用户控制 Worker | POST /api/agents/:id/inject 注入文字到 Worker | ✅ | T21 |
| C4 | @dispatch 自动路由 | PTY idle 时扫描 @dispatch pattern 自动注入 Worker | ✅ | T22 |

### 1.2 Agent 管理

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| C5 | 多 Agent 管理 | 创建/列出/查看/删除 Agent（Master/Worker） | ✅ | T2, T11 |
| C6 | PTY 交互模式 | 完整 claude-code 交互，支持所有 slash commands | ✅ | ui-smoke |
| C7 | 服务端持久运行 | Agent 进程不受客户端断开影响 | ✅ | T6 |
| C8 | 多端同时控制 | 同一 Agent 多个 WS 客户端同时连接，输出广播 | ✅ | T5 |
| C9 | 断线重连回放 | 客户端重连后自动回放最近 output buffer | ✅ | T3 |
| C10 | 切换工作目录 | 📂 按钮 → 弹窗(浏览器+最近目录) → 重启 | ✅ | T17 |
| C12 | 创建 Agent 时自动建目录 | 目录不存在则 mkdir -p，无需用户手动创建 | ✅ | T25 |
| C11 | 记忆常用启动命令 | GET /api/recent-commands，create/restart 时自动记录 | ✅ | T18 |

### 1.3 适配器层

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| A1 | AIAdapter 抽象基类 | 事件驱动接口 (data/exit/write/resize/stop/restart) | ✅ | T4 |
| A2 | ClaudeCodeAdapter | 持久 PTY 进程，--dangerously-skip-permissions | ✅ | T4, ui-smoke |
| A3 | MockAdapter | 测试用 echo 适配器 | ✅ | T1-T14 |
| A4 | Worker 可替换 | 接口抽象验证：mock adapter 通过相同 API 工作 | ✅ | T24 |

---

## 2. UI 交互

### 2.1 终端渲染

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| U1 | xterm.js 终端渲染 | 完整 ANSI 颜色、进度条、diff 显示 | ✅ | ui-smoke |
| U2 | 自适应终端尺寸 | fitAddon 自动调整 cols/rows，resize 通知 PTY | ✅ | (内含于所有UI测试) |
| U3 | Worker 历史浏览 | ⏪ 按钮加载 2000 条历史到终端 | ✅ | T15 |

### 2.2 输入

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| U5 | 手机键盘输入 | 自定义聊天 UI，不依赖 xterm，原生 textarea 输入 | 🔲 重构中 | — |
| U15 | 虚拟按键栏 | 仅保留 claude-code 交互需要的按键(Tab/Esc/↑↓等) | 🔲 重构中 | — |
| U16 | 方案A: 自定义聊天UI | stream-json API 驱动，自己渲染消息气泡+工具调用 | 🔲 | — |
| U17 | 离线输入 | 网络断开时可输入/编辑，重连后自动发送 | 🔲 | — |
| U18 | 多轮对话(自管理) | 服务端维护历史，每轮传完整 history，--no-session-persistence | 🔲 | — |
| U19 | 自实现 Compact | 历史超长时自动摘要压缩，替代 /compact | 🔲 | — |
| U6 | UI 与网络解耦 | 消息队列缓冲，WS 断开不丢输入，重连自动 flush | ✅ | mobile:queue |

### 2.3 侧栏与导航

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| U7 | 移动端侧栏收起 | ☰ 汉堡菜单，点击展开/收起 | ✅ | mobile:hamburger |
| U8 | Agent 等待输入状态 | 左侧列表显示 ⏳（PTY 2 秒无输出触发） | ✅ | T13 |
| U9 | 右键删除 Agent | Sidebar 右键菜单确认删除 + kill PTY | ✅ | T11 |
| U10 | claude-code 指令提示 | PTY 输出即时显示；断线后重连回放（由 U6+C5 覆盖） | ✅ | T3, mobile:queue |

### 2.4 弹窗与表单

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| U11 | 新建 Agent 弹窗 | Modal 表单（点空白不关闭，ESC/取消才关） | ✅ | mobile:modal |
| U12 | 目录浏览器 | 新建 Agent 时可点击浏览服务器目录 | ✅ | T12 |

### 2.5 文件浏览

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| U13 | 浏览服务器文件 | 🗂 按钮打开右侧面板，点击浏览目录 | ✅ | T12 |
| U14 | 阅读文件内容 | 点击文件显示内容（代码预览） | ✅ | T16 |

---

## 3. 文件/图片

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| F1 | 文件上传 | POST /api/files 上传 base64 文件 | ✅ | T7 |
| F2 | 文件消息 | 消息中引用 fileId，路径注入 PTY | ✅ | T8 |
| F3 | 图片粘贴 | Ctrl+V 粘贴图片 → 上传 → 路径注入 PTY | ✅ | T17a |
| F4 | 文件选择器 | 📎 按钮选文件 → 上传 → 路径注入 PTY | ✅ | mobile:attach |

---

## 4. Master 记忆系统

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| M1 | 记忆 API | GET /api/memory 返回所有偏好记忆 | ✅ | T9 |
| M2 | Master systemPrompt | Master 的 config 中动态注入 memory 内容 | ✅ | T10 |
| M3 | 跨 Agent 对话分析 | POST /api/agents/:id/analyze 触发后台分析 | ✅ | T23 |

---

## 5. 基础设施

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| I1 | HTTP API | /api/agents, /api/files, /api/memory, /api/browse | ✅ | T1,T2,T7,T9,T12 |
| I2 | WebSocket 协议 | /ws?agentId= input/resize/output/history/status | ✅ | T3-T5 |
| I3 | SQLite 持久化 | agents, output_buffer, files, memory | ✅ | T2-T14 |
| I4 | PM2 进程管理 | prod(4280) + dev(4281) 分别管理 | ✅ | T14 |
| I5 | 多环境隔离 | prod/dev 不同端口+DB，代码更新只重启 dev | ✅ | T14 |

---

## 6. 测试要求

| # | 要求 | 说明 | 状态 |
|---|------|------|------|
| T-R1 | 每个功能有 E2E 回归测试 | 所有功能都有对应测试 | ✅ |
| T-R2 | 手机 UI 模拟交互测试 | Playwright Pixel 5 viewport, 5 tests | ✅ |
| T-R3 | 桌面 UI 模拟交互测试 | Playwright desktop viewport 完整流程 | ✅ |
| T-R4 | 每个 Bug 修复后加回归测试 | BUG1→mobile:keyboard, BUG3→mobile:queue | ✅ |

---

## 7. Roadmap

### Phase 1 — 紧急修复（当前）
| 顺序 | 目标 | 涉及功能 |
|------|------|---------|
| 1 | 修复手机键盘输入 | U5, BUG1 |
| 2 | UI 与网络解耦 | U6, U10, BUG3 |
| 3 | 手机 UI 回归测试 | T-R2 |

### Phase 2 — 核心体验补全
| 顺序 | 目标 | 涉及功能 |
|------|------|---------|
| 4 | Worker 历史浏览 | U3 |
| 5 | 文件浏览与阅读 | U13, U14 |
| 6 | 切换工作目录 + 记忆常用命令 | C10, C11 |

### Phase 3 — 中间层 & Master 控制
| 顺序 | 目标 | 涉及功能 |
|------|------|---------|
| 7 | 中间层架构实现 | C1 |
| 8 | Master 感知 Hub Agents | C2, C3 |
| 9 | @dispatch 自动路由 | C4 |
| 10 | 跨 Agent 对话分析 + 记忆提取 | M3 |

### Phase 4 — 扩展
| 顺序 | 目标 | 涉及功能 |
|------|------|---------|
| 11 | Worker 可替换验证（非 claude adapter） | A4 |
| 12 | 记忆常用启动命令 | C11 |

---

## 8. 已知 Bug

| # | 问题 | 原因 | 优先级 | 回归测试 |
|---|------|------|--------|---------|
| ~~BUG1~~ | ~~手机键盘输入失效 (U5)~~ | ~~已修复: disableStdin on mobile~~ | — | ✅ mobile:keyboard |
| ~~BUG2~~ | ~~Master 无法感知 Hub 内 Agent~~ | ~~已修复: /summaries /inject API~~ | — | ✅ T19-T21 |
| ~~BUG3~~ | ~~网络卡顿时 UI 操作卡死 (U6)~~ | ~~已修复: sendQueue + flush~~ | — | ✅ mobile:queue |
| ~~BUG4~~ | ~~切换 Agent 后对话历史丢失~~ | ~~已修复: _handleEvent 里提前存 history~~ | — | ✅ chat-smoke:BUG4 |
