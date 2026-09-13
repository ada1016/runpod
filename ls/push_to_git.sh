#!/bin/bash
set -euo pipefail

GIT_ROOT="/Users/mingdajiang/Documents/runpod"

cd "$GIT_ROOT"

echo "=== Current Git status ==="
git status --short -- ls/

echo
echo "=== Adding everything under tab5/ ==="
git add -A ls/

echo
echo "=== Changes to be committed ==="
git status --short -- ls/

# Stop if there is actually nothing to commit
if git diff --cached --quiet; then
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