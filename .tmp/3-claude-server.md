# claude-server: PTY adapter 绕过 launcher 导致 hooks 不生效

## 现象

通过 claude-server Web UI 创建的 Agent，其 claude 进程没有任何 hooks 生效（Stop/SessionStart/SessionEnd 从不触发）。即使 launcher 和 claude-mem 都正确配置，从 Web 创建的 agent 也不会触发记忆提取。

## 根因

`core/adapter/claude-code.js` 直接调用 `claude` 二进制：
```js
pty.spawn('claude', ['--dangerously-skip-permissions'], { cwd, ... })
```

这绕过了 `~/.local/bin/claude-code` launcher。Launcher 中的：
- settings.json 写入（env vars, model 配置）
- merge-hooks.py 调用
- CLAUDE_CONFIG_DIR 设置

全部被跳过。Claude 进程启动时读到的 settings.json 没有 hooks。

## 建议修复（从 claude-server 自身角度提升鲁棒性）

### Fix 1：使用 launcher 而非直接调 claude binary

```js
// 改为调用 launcher（它负责写 settings + merge hooks）
const claudeBin = process.env.CLAUDE_BIN ?? 'claude-code';  // 不是 'claude'
pty.spawn(claudeBin, ['--dangerously-skip-permissions'], { cwd, ... })
```

但这引入了对 launcher 的依赖，且 launcher 是交互式的（要选模型），不适合 server 自动启动。

### Fix 2：claude-server 自己在 spawn 前确保 hooks 存在

在 `_spawn()` 之前，主动调用 merge-hooks：
```js
_spawn() {
  // 确保 Claude 启动后能看到 hooks
  const mergeScript = path.join(process.env.HOME, '.claude-mem-xiaomi/scripts/merge-hooks.py');
  if (fs.existsSync(mergeScript)) {
    execSync(`python3 "${mergeScript}"`, { stdio: 'ignore' });
  }
  
  this._pty = pty.spawn(claudeBin, args, { cwd, env: { ...process.env, ... } });
}
```

### Fix 3：设置正确的环境变量（与 launcher 行为一致）

```js
_spawn() {
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: '.claude/roles/' + (process.env.USER ?? 'default'),
    // ... 其他 launcher 设置的 env vars
  };
  this._pty = pty.spawn(claudeBin, args, { cwd, env });
}
```

### Fix 4（推荐）：把 spawn 配置抽成可配置项

让用户在创建 Agent 时指定完整启动命令，默认使用 launcher：
```json
{
  "name": "Worker-1",
  "config": {
    "command": "claude-code",
    "args": ["--dangerously-skip-permissions"],
    "env": { "CLAUDE_CONFIG_DIR": ".claude/roles/yinrong" },
    "cwd": "/home/yinrong/project"
  }
}
```

这样 claude-server 不硬编码任何假设，用户可以控制 Agent 的完整启动行为。
