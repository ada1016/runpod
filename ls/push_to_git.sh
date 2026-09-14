#!/bin/bash
set -euo pipefail

# Find the repository root dynamically (or resolve relative to the script's location)
if git rev-parse --show-toplevel >/dev/null 2>&1; then
    GIT_ROOT="$(git rev-parse --show-toplevel)"
else
    # Fallback: parent folder of the directory containing this script
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    GIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

cd "$GIT_ROOT"

echo "=== Git Root: $GIT_ROOT ==="

echo "=== Current Git status ==="
git status --short -- ls/

echo
echo "=== Adding everything under ls/ ==="
git add -A ls/

echo
echo "=== Changes to be committed ==="
git status --short -- ls/

# Stop if there is actually nothing to commit
if git diff --cached --quiet -- ls/; then
    echo
    echo "Nothing changed under ls/. Nothing to commit."
    exit 0
fi

echo
MESSAGE="WD update $(date '+%Y-%m-%d %H:%M:%S')"
git commit -m "$MESSAGE" -- ls/

echo
echo "=== Pushing to GitHub ==="
git push origin main

echo
echo "=== Done ==="
git status