#!/bin/bash
set -euo pipefail

GIT_ROOT="/Users/mingdajiang/Documents/runpod"

cd "$GIT_ROOT"

echo "=== Current Git status ==="
git status --short

echo
echo "=== Adding everything under tab5/ ==="
git add -A tab5/

echo
echo "=== Changes to be committed ==="
git status --short

# Stop if there is actually nothing to commit
if git diff --cached --quiet; then
    echo
    echo "Nothing changed under tab5/. Nothing to commit."
    exit 0
fi

echo
read -r -p "Commit message [Update Tab5]: " MESSAGE
MESSAGE=${MESSAGE:-"Update Tab5"}

git commit -m "$MESSAGE"

echo
echo "=== Pushing to GitHub ==="
git push origin main

echo
echo "=== Done ==="
git status