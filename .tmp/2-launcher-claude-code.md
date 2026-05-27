# Launcher (claude-code): 每次启动覆盖 settings.json 导致 hooks 丢失

## 现象

任何通过 `~/.local/bin/claude-code` 启动的 Claude 会话，其 `~/.claude/settings.json` 中的 hooks 配置在启动时被清除。第三方插件（如 claude-mem）注入的 hooks 静默失效。

## 根因

Launcher 第 102 行使用 `cat >` 覆写 settings.json：
```bash
cat > "$HOME/.claude/settings.json" << EOF
{
  "env": { ... },
  "skipDangerousModePermissionPrompt": true
}
EOF
```

这是**破坏性写入**（overwrite），不是 merge。任何之前存在的 hooks、permissions、或其他第三方配置全部丢失。

## 建议修复（从 launcher 自身角度提升鲁棒性）

### Fix 1：改用 merge 而非 overwrite

```bash
# 只确保必要字段存在，不覆盖其他内容
python3 -c "
import json, os

path = os.path.expanduser('~/.claude/settings.json')
existing = {}
if os.path.exists(path):
    try: existing = json.load(open(path))
    except: pass

# 只设置 launcher 需要的字段
existing.setdefault('env', {}).update({
    'hasCompletedOnboarding': 'true',
    'ANTHROPIC_BASE_URL': '$BASE_URL',
    'ANTHROPIC_AUTH_TOKEN': '$AUTH_TOKEN',
    'ANTHROPIC_DEFAULT_OPUS_MODEL': '$MODEL_ARG',
    'ANTHROPIC_DEFAULT_SONNET_MODEL': '$MODEL_ARG',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL': '$MODEL_ARG',
})
existing['skipDangerousModePermissionPrompt'] = True

with open(path, 'w') as f:
    json.dump(existing, f, indent=2, ensure_ascii=False)
"
```

### Fix 2：如果必须 overwrite，提供 post-write hook 点

```bash
# 写入 settings.json 后，执行 post-settings hooks
cat > "$HOME/.claude/settings.json" << EOF
...
EOF

# 允许第三方在写入后 merge 自己的配置
for hook in "$HOME/.claude/post-settings.d/"*.sh; do
    [[ -x "$hook" ]] && bash "$hook" 2>/dev/null || true
done
```

### Fix 3：CLAUDE_CONFIG_DIR 与全局 settings 的关系文档化

当前 launcher 同时做了两件事：
1. 写 `~/.claude/settings.json`
2. 设 `CLAUDE_CONFIG_DIR=.claude/roles/$USER`

但如果 Claude 读的是 `$CWD/$CLAUDE_CONFIG_DIR/settings.json` 而非 `~/.claude/settings.json`，那第 1 步写入的内容可能根本不生效。需要明确：launcher 写入的文件是否就是 Claude 实际读取的文件。
