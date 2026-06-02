# Claude Hub

Multi-agent orchestration server for [Claude Code](https://github.com/anthropics/claude-code). Manage multiple claude-code instances from a single web UI, accessible from phone and desktop simultaneously.

## Features

- **Full interactive mode** — All slash commands work (`/resume`, `/compact`, `/clear`)
- **Multi-agent** — Run Master + N Workers, Master can dispatch tasks to Workers
- **Mobile friendly** — Virtual key bar (Enter/Esc/Tab/arrows/Ctrl+C), responsive layout
- **Persistent** — Agents keep running when you close the browser; reconnect replays history
- **Multi-client** — Phone and PC can control the same agent simultaneously
- **Image/file upload** — Paste or pick files, paths injected into PTY
- **Memory system** — Master learns user preferences from Worker conversations

## Quick Start

```bash
# Install
npm install

# Start (production on :4280, dev on :4281)
pm2 start ecosystem.config.cjs

# Or just run directly
PORT=4280 node server/index.js
```

Open `http://localhost:4280`, click **＋** to create your first Agent.

## Development

```bash
# Start dev server only (doesn't affect production)
pm2 start ecosystem.config.cjs --only claude-server-dev

# Run tests (uses isolated port 37890 + separate DB)
npm test

# Run mobile UI tests
npx playwright test tests/mobile.test.js

# Run smoke tests (requires prod running on 4280)
xvfb-run --auto-servernum npx playwright test --config=playwright.smoke.config.js
```

## Architecture

See [CLAUDE.md](./CLAUDE.md) for full architecture docs, design decisions, and API reference.

See [FEATURES.md](./FEATURES.md) for the complete feature list with test coverage status.

## Environments

| Env | Port | DB | PM2 name | Purpose |
|-----|------|-----|----------|---------|
| prod | 4280 | data/prod.db | claude-server-prod | Stable, never restart carelessly |
| dev | 4281 | data/dev.db | claude-server-dev | Development, restart freely |
| test | 37890 | data/test.db | (auto) | Playwright E2E tests |

**Rule**: Code updates only restart dev. Never `pm2 delete all`.
