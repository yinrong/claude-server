# 设计：选择模型名称

## 需求背景

当前 Agent 创建时固定使用系统默认模型。用户需要能为每个 Agent 选择不同的模型。

## 已确认决策

| 项 | 决策 |
|----|------|
| 模型列表来源 | 手动维护列表 + UI 提供"刷新"按钮重新拉取 |
| 运行中切换模型 | 不支持（切换需重建 Agent） |

## 方案

### 接口变更

创建 Agent 时 config 增加 `model` 字段：
```json
{
  "name": "FastWorker",
  "adapterType": "claude-code",
  "config": {
    "cwd": "/home/project",
    "model": "claude-sonnet-4-6"
  }
}
```

新增 API：
```
GET /api/models        — 返回可用模型列表（从 DB 缓存或 proxy 拉取）
POST /api/models/refresh — 触发重新从 proxy 拉取模型列表
```

### PTY adapter 实现
```js
const modelArgs = config.model ? ['--model', config.model] : []
pty.spawn('claude', ['--dangerously-skip-permissions', ...modelArgs], { cwd })
```

### 前端

创建 Agent 弹窗增加模型选择下拉框：
- 默认显示 DB 中缓存的模型列表
- 提供"刷新"按钮触发 `POST /api/models/refresh`
- 无模型选择时使用系统默认

### DB schema 变更

新增 `models` 表：
```sql
models (id, name, display_name, updated_at)
```
