# Feature List

> 本文件是项目功能的 single source of truth。每次需求变动必须同步更新。
> 每个功能都必须有对应的 E2E 回归测试。

状态：✅ 测试通过 | 🔄 开发中 | ⚠️ 已实现未测试 | ❌ 失效/Bug | 🔲 未实现

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
| U20 | 文件下载 | GET /api/download?path= + 面板下载按钮 | ✅ | T27 |

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

## 5. 服务端增强

### 5.1 对话状态恢复

详细设计：[docs/design/session-restore.md](docs/design/session-restore.md)

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| SR1 | 重启后自动恢复 PTY session | DB 存 last_session_id，重启用 --resume 恢复 | ✅ | T28,T29 |

### 5.2 模型选择

详细设计：[docs/design/model-selection.md](docs/design/model-selection.md)

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| MS1 | Agent 创建时选择模型 | config.model 传给 --model 参数；前端弹窗加下拉框 | ✅ | MS1,T30,T31 |
| MS2 | 模型列表 + 手动刷新 | GET /api/models + POST /api/models/refresh；前端刷新按钮 | ✅ | MS2a,MS2b,MS2c,T30 |
| MS3 | 从 proxy 动态拉取全部可用模型，名称含 provider 前缀 | refresh 返回所有 LLM 模型，名称格式为 {owned_by}/{id} | ✅ | MS3,MS2b,MS2c |

---

## 6. Flutter 手机客户端

详细设计：[docs/design/mobile-client.md](docs/design/mobile-client.md)

### 6.1 统一接口层

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| MC1 | /api/v2 统一接口层 | 标准化响应格式 + since_ts 增量查询 | ✅ | MC1-T1~T5 |

### 6.2 Flutter App

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| MC2 | Flutter App 基础框架 | Android/iOS，WS 客户端 | ⚠️ | 缺 integration_test |
| MC3 | WS 长连接保活 | 30s 心跳 + 指数退避重连 + 首次省电引导弹窗 | ⚠️ | 缺 integration_test |
| MC4 | Agent 列表 + 实时状态 | ⏳/●/○ 状态，多设备同时连接 | ⚠️ | 缺 integration_test |
| MC5 | 快速回复 | 直接向 Agent 发送文字指令 | ⚠️ | 缺 integration_test |
| MC6 | 对话历史查看 | 查看完整对话记录 | ⚠️ | 缺 integration_test |
| MC7 | 文件浏览 | 浏览 Agent 工作目录 | ⚠️ | 缺 integration_test |
| MC8 | Diff / 代码变更查看 | 查看 Agent 做的代码变更 | ⚠️ | MC8-T1,MC8-T2（服务端），缺 Flutter integration_test |

---

## 7. ai-hub 整合

### 7.1 router 组件（原 llm-router/x）

详细设计：[docs/design/ai-hub-architecture.md](docs/design/ai-hub-architecture.md)

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| R1 | router 进程启动 | PM2 管理，GET /healthz 返回 200 | ✅ | pytest:healthz |
| R2 | router 现有 E2E 通过 | 迁入后原有 55 个 E2E pytest 测试通过（原版一致） | ✅ | pytest:all |

### 7.2 llm 组件（原 llm-api）

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| LM1 | llm 模块可 import | `from llm import get_llm` 正常工作 | ✅ | pytest:import |
| LM2 | llm 配置从环境变量读取 | 不硬编码地址和 key | ✅ | test_conf:lm2 |
| LM3 | 多 provider 切换 | `get_llm(provider='openai'/'anthropic')` | ✅ | test_conf:lm3 |

### 7.3 tunnel 组件（原 llm-router/c）

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| TN1 | tunnel 独立安装包 | pip install 后可运行 `python -m tunnel` | ✅ | test_package |

---

## 8. 基础设施

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| I1 | HTTP API | /api/agents, /api/files, /api/memory, /api/browse | ✅ | T1,T2,T7,T9,T12 |
| I2 | WebSocket 协议 | /ws?agentId= input/resize/output/history/status | ✅ | T3-T5 |
| I3 | SQLite 持久化 | agents, output_buffer, files, memory | ✅ | T2-T14 |
| I4 | PM2 进程管理 | prod(4280) + dev(4281) 分别管理 | ✅ | T14 |
| I5 | 多环境隔离 | prod/dev 不同端口+DB，代码更新只重启 dev | ✅ | T14 |

---

## 9. 测试要求

| # | 要求 | 说明 | 状态 |
|---|------|------|------|
| T-R1 | 每个功能有 E2E 回归测试 | 所有功能都有对应测试 | ✅ |
| T-R2 | 手机 UI 模拟交互测试 | Playwright Pixel 5 viewport, 5 tests | ✅ |
| T-R3 | 桌面 UI 模拟交互测试 | Playwright desktop viewport 完整流程 | ✅ |
| T-R4 | 每个 Bug 修复后加回归测试 | BUG1→mobile:keyboard, BUG3→mobile:queue | ✅ |

---

## 12. 文件生成监控与下载

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| FD1 | 检测 agent 新生成文件 | PTY idle 后扫描 cwd，通过 WS 广播 `file_created` 事件，按 mtime 倒序 | ✅ | FD1-T1 |
| FD2 | 文件列表 API | GET /api/agents/:id/files 返回 cwd 内文件列表，按 mtime 倒序 | ✅ | FD2-T1 |
| FD3 | 单文件下载 | 文件列表中的 download_url 可直接下载 | ✅ | FD3-T1 |
| FD4 | 多文件压缩打包下载 | POST /api/agents/:id/zip { paths[] } 生成 zip 返回下载流 | ✅ | FD4-T1 |
| FD5 | UI：生成文件面板 | agent 侧边📋按钮，显示倒序列表+下载链接+多选打包；PTY idle 自动扫描；WS file_created 实时刷新 | ✅ | FD1-T1,FD2-T1 |

---

## 11. 核心用户场景验证

| # | 功能 | 说明 | 状态 | 测试 |
|---|------|------|------|------|
| CV1 | 创建 claude-code 终端并完成任务 | 创建 PTY agent，发送任务，claude 在 workspace 完成并生成文件 | ✅ | CV1-T1 |
| CV2 | 生成文件并下载 | claude 生成文件后用户通过 /api/download 下载到本地 | ✅ | CV2-T1 |
| CV3 | VSCode 通过 ai-hub 通道访问工作空间 | /api/agents/:id/workspace 返回 SSH 连接信息，用户可用 VSCode Remote SSH 打开 cwd | ✅ | CV3-T1 |
| CV4 | C (tunnel) 被意外 kill 后自动恢复 | SIGKILL tunnel 进程后，它自动重连，LLM 请求恢复正常 | ✅ | CV4-T1 |

---

## 10. Roadmap

### 已完成
所有 server/Flutter 核心功能已实现，见上方各表。

### 待完成
| 功能 | 说明 |
|------|------|
| AU1~AU4 | 多用户认证（见 [ai-hub-architecture.md](docs/design/ai-hub-architecture.md)） |
| MC2~MC8 | Flutter App 功能缺少 integration_test（当前测试均为 Dart 单元测试，不符合规范） |

---

## 10. 已知 Bug



| # | 问题 | 原因 | 优先级 | 回归测试 |
|---|------|------|--------|---------|
| ~~BUG1~~ | ~~手机键盘输入失效 (U5)~~ | ~~已修复: disableStdin on mobile~~ | — | ✅ mobile:keyboard |
| ~~BUG2~~ | ~~Master 无法感知 Hub 内 Agent~~ | ~~已修复: /summaries /inject API~~ | — | ✅ T19-T21 |
| ~~BUG3~~ | ~~网络卡顿时 UI 操作卡死 (U6)~~ | ~~已修复: sendQueue + flush~~ | — | ✅ mobile:queue |
| ~~BUG4~~ | ~~切换 Agent 后对话历史丢失~~ | ~~已修复: _handleEvent 里提前存 history~~ | — | ✅ chat-smoke:BUG4 |
| ~~BUG5~~ | ~~E2E 测试全用 mock 未检测到 claude binary 损坏~~ | ~~已修复: T26 调用真实 claude~~ | — | ✅ T26 |
| ~~BUG6~~ | ~~模型列表缺少 provider 前缀：`pa/claude-sonnet-4-6` 应为 `ppio/pa/claude-sonnet-4-6`~~ | ~~已修复: `fetchModelsFromProxy` 改为始终用 `owned_by/id`~~ | — | ✅ BUG6 |
