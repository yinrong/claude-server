#!/usr/bin/env bash
# Usage: ./scripts/deploy.sh [dev|prev|prod]
# Only dev is safe to run anytime. prev/prod require explicit intent.
set -euo pipefail

TARGET="${1:-}"
ECOSYSTEM="$(cd "$(dirname "$0")/.." && pwd)/ecosystem.config.cjs"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$ECOSYSTEM" ] || die "ecosystem.config.cjs not found at $ECOSYSTEM"

deploy_one() {
  local name="$1"
  echo ">>> Deploying $name (delete + start to reload env)..."
  pm2 delete "$name" 2>/dev/null || true
  pm2 start "$ECOSYSTEM" --only "$name"
  pm2 save --force
  echo ">>> $name deployed. Status:"
  pm2 show "$name" | grep -E "status|uptime|cpu|memory" || true
}

case "$TARGET" in
  dev)
    deploy_one "ai-hub-server-dev"
    ;;
  prev)
    deploy_one "ai-hub-server-prev"
    ;;
  prod)
    deploy_one "ai-hub-server-prod"
    ;;
  all)
    # First-time / full rebuild only — destroys everything
    echo ">>> Full rebuild: deleting all pm2 processes..."
    pm2 delete all 2>/dev/null || true
    pm2 start "$ECOSYSTEM"
    pm2 save --force
    echo ">>> All processes started."
    pm2 list
    ;;
  "")
    die "Usage: $0 [dev|prev|prod|all]"
    ;;
  *)
    die "Unknown target '$TARGET'. Use: dev | prev | prod | all"
    ;;
esac
