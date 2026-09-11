#!/bin/bash
set -euo pipefail

GIT_ROOT="/Users/mingdajiang/Documents/runpod"

cd "$GIT_ROOT"

echo "=== Current Tab5 Git status ==="
git status --short -- tab5/

echo
echo "=== Adding everything under tab5/ ==="
git add -A tab5/

echo
echo "=== Tab5 changes to be committed ==="
git status --short -- tab5/

# Stop if there is actually nothing to commit
if git diff --cached --quiet; then
    echo
    echo "Nothing changed under tab5/. Nothing to commit."
    exit 0
fi

echo

MESSAGE="Tab5 update $(date '+%Y-%m-%d %H:%M:%S')"
git commit -m "$MESSAGE" -- tab5/

echo
echo "=== Pushing to GitHub ==="
git push origin main

echo
echo "=== Done ==="
git status