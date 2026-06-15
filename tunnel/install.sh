#!/bin/bash
# One-click install for ai-hub-tunnel
# Usage:
#   ./install.sh                  # install from local path (development)
#   ./install.sh --git            # install from git repo

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--git" ]]; then
    # Install from git (replace URL with your actual repo)
    pip install "git+https://github.com/yinrong/ai-hub.git#subdirectory=tunnel"
else
    # Install in editable mode from the local tunnel/ directory
    pip install -e "$SCRIPT_DIR"
fi

echo "ai-hub-tunnel installed. Run with: python -m tunnel"
