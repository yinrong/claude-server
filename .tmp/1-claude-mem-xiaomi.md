# claude-mem-xiaomi: Hooks 未生效分析

## 现象

Hooks（Stop/SessionStart/SessionEnd）从未触发，summarize 管线完全停止。最后一次成功运行：2026-05-12。

## 根因

### 问题 1：merge-hooks.py 写入路径不感知 CLAUDE_CONFIG_DIR

当前 `merge-hooks.py` 硬编码写入：
```python
settings_path = os.path.join(home, ".claude", "settings.json")
```

但如果上层启动器设置了 `CLAUDE_CONFIG_DIR=.claude/roles/$USER`，Claude 实际读取的是 `<cwd>/.claude/roles/<user>/settings.json`，而不是 `~/.claude/settings.json`。

Hooks 写到了 Claude 不会读取的文件里。

### 问题 2：依赖 Launcher patch 但 patch 不持久

当前架构假设 launcher 会在 `exec claude` 之前调用 `merge-hooks.py`。但 launcher 是外部项目，可能被更新/重装/覆盖，导致 patch 丢失。一旦 patch 丢，整个记忆系统静默失效，无任何报错。

## 建议修复（从 claude-mem 自身角度提升鲁棒性）

### Fix 1：merge-hooks.py 支持多路径写入

```python
# 写入所有可能的 settings 位置
paths = [
    os.path.join(home, ".claude", "settings.json"),  # 默认
]

# 如果存在 CLAUDE_CONFIG_DIR 环境变量或常见 pattern
config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
if config_dir:
    # 可能是相对路径，需遍历常用 cwd
    ...

# 或扫描已知 settings.json 文件
for p in glob.glob(os.path.join(home, ".claude/roles/*/settings.json")):
    paths.append(p)

for path in paths:
    deep_merge_hooks(path, hooks_config)
```

### Fix 2：增加自检/健康检查机制

在 `session-start.sh` 或 skill 中增加检查：
```bash
# 验证当前 Claude 进程是否能看到 hooks
if ! grep -q "session-start.sh" "$ACTUAL_SETTINGS_PATH" 2>/dev/null; then
    echo "[claude-mem] WARNING: hooks not found in active settings.json"
    echo "[claude-mem] Running merge-hooks to fix..."
    python3 "$MEM_DIR/scripts/merge-hooks.py"
fi
```

### Fix 3：不依赖 launcher patch，改用 Claude 原生机制

如果 Claude Code 支持从多个路径加载 hooks（如 `~/.claude/hooks.json`），应直接使用，避免需要 patch 外部 launcher。

或者：在 `~/.claude/roles/<user>/settings.json` 中直接维护 hooks（这是 Claude 实际读取的位置），而不是写到 `~/.claude/settings.json`。
