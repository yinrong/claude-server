# llm — LLM 访问包

ai-hub 的 LLM 访问层（原 `llm-api/llm_api`）。封装 OpenAI 兼容 API 的调用，提供统一的 LLM 访问入口，支持 OpenAI 和 Anthropic 双后端，返回值结构统一。

## 使用方式

```python
from llm import get_llm

llm = get_llm()
response = llm.call("你好，介绍一下自己")
print(response.choices[0].message.content)
```

### 带工具调用

```python
import json
from llm import get_llm

llm = get_llm()

tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "获取城市天气",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

messages = [{"role": "user", "content": "北京今天天气怎么样？"}]
response = llm.call(messages, tools=tools)
```

## API 参考

### `get_llm(log_dir=None, api_type="openai") -> LLM`

工厂函数，等价于 `LLM(log_dir=log_dir, api_type=api_type)`。

### `llm.call(messages, tools=None, **kwargs) -> response`

| 参数 | 类型 | 说明 |
|------|------|------|
| `messages` | `list[dict] \| str` | 消息列表，str 自动包装为 `[{"role":"user","content":...}]` |
| `tools` | `list[dict] \| None` | OpenAI function-calling 格式工具列表 |
| `model` | `str` | 覆盖默认模型 |
| `provider` | `str` | 仅 OpenAI 后端，覆盖默认 provider 路由 |
| `temperature` | `float` | 采样温度 |
| `max_tokens` | `int` | 最大生成 token 数（Anthropic 后端默认 8192） |

### Response 结构

```python
response.choices[0].message.content        # str | None — 文本回复
response.choices[0].message.tool_calls     # list — 工具调用列表（无调用时为空 list）
response.choices[0].finish_reason          # "stop" | "tool_calls"
response.usage.prompt_tokens               # 输入 token 数
response.usage.completion_tokens           # 输出 token 数
```

## Provider 配置

配置通过环境变量注入（由 `ecosystem.config.cjs` 或 `.env` 提供），无需修改代码。

### OpenAI 后端（`api_type="openai"`）

| 环境变量 | 说明 |
|----------|------|
| `LLM_BASE_URL` | OpenAI 兼容 API 地址 |
| `LLM_API_KEY` | API Key |
| `LLM_DEFAULT_PROVIDER` | 默认 provider（通过 `X-Model-Provider-Id` header 路由）|
| `LLM_DEFAULT_MODEL` | 默认模型 |

常用 provider 和模型：

| provider | model | 说明 |
|----------|-------|------|
| `xiaomi` | `mimo-v2-flash` | 默认，快速模型 |
| `xiaomi` | `Qwen3-235B-A22B` | Qwen3 MoE 旗舰 |
| `ppio` | `gemini-2.5-pro` | Google Gemini 2.5 Pro |
| `ppio` | `gpt-4.1` | GPT-4.1 |
| `tongyi` | `qwen-max` | 通义千问 Max |
| `deepseek` | `deepseek-v4-pro` | DeepSeek V4 Pro |

### Anthropic 后端（`api_type="anthropic"`）

| 环境变量 | 说明 |
|----------|------|
| `ANTHROPIC_BASE_URL` | Anthropic API 地址 |
| `ANTHROPIC_API_KEY` | API Key |
| `ANTHROPIC_DEFAULT_MODEL` | 默认模型（如 `ppio/pa/claude-opus-4-6`）|

Anthropic 后端特殊行为：
- `role="system"` 消息自动提取为 Anthropic system 参数
- 工具定义自动从 OpenAI format 转为 Anthropic format
- 返回值已适配为和 OpenAI 后端相同的结构

## 指定 provider 调用

```python
llm.call(messages, model="qwen-plus", provider="tongyi")
llm.call(messages, model="gemini-2.5-pro", provider="ppio")
llm.call(messages, model="deepseek-v4-pro", provider="deepseek")
```

## 日志

传入 `log_dir` 启用自动日志记录：

```python
llm = get_llm(log_dir="/path/to/logs")
# 自动记录到 /path/to/logs/agent.log
```

手动记录工具结果：

```python
if llm.logger:
    llm.logger.log_tool_result("get_weather", "晴，28°C")
```

## 目录结构

```
llm/
├── __init__.py     ← get_llm()、LLM、reload_model_list 导出
├── _conf.py        ← 连接配置（从环境变量读取）
├── _client.py      ← OpenAI/Anthropic 双后端实现
├── pyproject.toml
└── README.md
```
