# 设计：更新版本后恢复 claude-code 对话状态

## 需求背景

当代码更新重启 server 后（`pm2 restart claude-server-dev`），所有 Agent 的 PTY 进程被 kill，对话上下文丢失。用户需要能恢复上一次的对话继续工作。

需要区分 dev/prod：
- **prod** 重启频率低，但重启后恢复更关键
- **dev** 重启频繁，需要快速恢复

## 方案设计

### 对于 PTY adapter（当前 `claude-code` adapter）

claude-code 本身有 session 持久化（`~/.claude/projects/` 下的 `.jsonl` 文件）。重启后可以用 `--resume <session-id>` 恢复。

**实现：**
1. 创建 Agent 时记录 `session_id`（从 claude 输出的 init 事件中获取）到 DB
2. 重启后 `restoreFromDB` 时，用 `--resume <session_id>` 启动 claude
3. DB schema 加 `last_session_id` 字段到 agents 表

### 对于 Stream adapter（`claude-code-stream`）

历史在 adapter 内存中（`this._history`）。重启后丢失。

**实现：**
1. 每次 `sendMessage` 完成后，把 `this._history` 序列化写入 DB
2. `restoreFromDB` 时从 DB 加载 history 到 adapter 内存
3. DB schema：`agent_chat_history` 表或 agents.config 里加 `history` 字段

### 环境隔离

| 环境 | DB 路径 | 恢复行为 |
|------|---------|---------|
| prod | data/prod.db | 自动恢复所有 agent 的 session |
| dev | data/dev.db | 自动恢复，但可选"清空重来" |

### 具体流程

```
Server 启动
  → restoreFromDB()
    → 遍历 agents 表
      → PTY adapter: spawn claude --resume <session_id>
      → Stream adapter: 从 DB 加载 history 到内存
    → 广播 status: alive
```

---

## 待确认问题

1. PTY 模式下 `--resume` 是否兼容我们的 API proxy？（之前测试报 400）
2. 是否需要"不恢复"选项（有时用户想从干净状态开始）？
3. history 序列化到 DB 的频率——每轮还是定时？
