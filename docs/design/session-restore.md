# 设计：更新版本后恢复 claude-code 对话状态

## 需求背景

当代码更新重启 server 后，所有 Agent 的 PTY 进程被 kill，对话上下文丢失。用户需要能恢复上一次的对话继续工作。

## 已确认决策

| 项 | 决策 |
|----|------|
| PTY `--resume` 可用性 | 已确认可用（之前 400 问题已修复） |
| "不恢复"选项 | 不需要，始终自动恢复 |

## 方案

### PTY adapter（claude-code adapter）

claude-code 本身有 session 持久化（`~/.claude/projects/` 下的 `.jsonl` 文件）。重启后用 `--resume <session-id>` 恢复。

**实现：**
1. 创建 Agent 时记录 `session_id`（从 claude 输出的 init 事件中获取）到 DB
2. 重启后 `restoreFromDB` 时，用 `--resume <session_id>` 启动 claude

**DB schema 变更：**
- `agents` 表加 `last_session_id TEXT` 字段

### 具体流程

```
Server 启动
  → restoreFromDB()
    → 遍历 agents 表
      → PTY adapter: spawn claude --resume <session_id>
    → 广播 status: alive
```

### 环境隔离

| 环境 | DB 路径 | 恢复行为 |
|------|---------|---------|
| prod | data/prod.db | 自动恢复所有 agent 的 session |
| dev | data/dev-next.db | 自动恢复 |
