# 设计：选择模型名称

## 需求背景

当前 Agent 创建时固定使用系统默认模型（通过环境变量 `ANTHROPIC_DEFAULT_*_MODEL` 设置）。用户需要能为每个 Agent 选择不同的模型。

## 方案设计

### 接口变更

创建/编辑 Agent 时 config 增加 `model` 字段：
```json
{
  "name": "FastWorker",
  "adapterType": "claude-code-stream",
  "config": {
    "cwd": "/home/project",
    "model": "claude-sonnet-4-6"
  }
}
```

### 实现

**PTY adapter：**
```js
pty.spawn('claude', ['--dangerously-skip-permissions', '--model', config.model], { cwd })
```

**Stream adapter：**
```js
const args = ['--print', '--output-format', 'stream-json', '--model', config.model, ...]
```

### 前端

创建 Agent 弹窗增加模型选择下拉框：
- 选项从 `/api/models` 接口获取（或硬编码常用模型列表）
- 默认选中系统默认模型

### 可用模型列表

```
claude-opus-4-6
claude-sonnet-4-6
claude-haiku-4-5
```

或从用户配置的 proxy 动态获取（如果 proxy 支持 list models API）。

---

## 待确认问题

1. 模型列表从哪获取？硬编码 vs 动态查询 proxy？
2. 是否允许运行中切换模型（需要 restart agent）？
3. 是否需要显示每个模型的成本/速度信息？
