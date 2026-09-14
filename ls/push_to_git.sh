#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------
# Global OS X / Git configuration (runs idempotently)
# ---------------------------------------------------------
GLOBAL_GITIGNORE="${HOME}/.gitignore_global"

# Set core.excludesfile if not already configured
CURRENT_EXCLUDES="$(git config --global core.excludesfile 2>/dev/null || true)"
if [[ "$CURRENT_EXCLUDES" != "$GLOBAL_GITIGNORE" ]]; then
    git config --global core.excludesfile "$GLOBAL_GITIGNORE"
fi

# Append rules to global gitignore if missing
touch "$GLOBAL_GITIGNORE"
grep -qxF ".DS_Store" "$GLOBAL_GITIGNORE" || echo ".DS_Store" >> "$GLOBAL_GITIGNORE"
grep -qxF "._*" "$GLOBAL_GITIGNORE" || echo "._*" >> "$GLOBAL_GITIGNORE"

# ---------------------------------------------------------
# Target folder & Git root discovery
# ---------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GIT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$GIT_ROOT" ]]; then
    echo "Error: Not inside a Git repository." >&2
    exit 1
fi

TARGET_PATH="$(git -C "$PWD" rev-parse --show-prefix 2>/dev/null || true)"

if [[ -z "$TARGET_PATH" && "$SCRIPT_DIR" != "$GIT_ROOT" ]]; then
    TARGET_PATH="$(git -C "$SCRIPT_DIR" rev-parse --show-prefix 2>/dev/null || true)"
fi

[[ -n "$TARGET_PATH" && "$TARGET_PATH" != */ ]] && TARGET_PATH="${TARGET_PATH}/"

if [[ -n "$TARGET_PATH" ]]; then
    FOLDER_NAME="$(basename "$TARGET_PATH" | tr '[:lower:]' '[:upper:]')"
    SCOPE_PATH="$TARGET_PATH"
else
    FOLDER_NAME="ROOT"
    SCOPE_PATH="."
fi

# ---------------------------------------------------------
# Git Operations
# ---------------------------------------------------------
cd "$GIT_ROOT"

# Ensure local repo .gitignore also covers these entries
if [[ ! -f ".gitignore" ]]; then
    touch .gitignore
fi
grep -qxF ".DS_Store" .gitignore || echo ".DS_Store" >> .gitignore
grep -qxF "._*" .gitignore || echo "._*" >> .gitignore

# Stop tracking any existing .DS_Store files across the repository
find . -name ".DS_Store" -print0 | xargs -0 git rm --ignore-unmatch --cached -q 2>/dev/null || true

echo "=== Git Root: $GIT_ROOT ==="
echo "=== Target Directory: ${TARGET_PATH:-./} ==="

echo
echo "=== Current Git status ==="
git status --short -- "$SCOPE_PATH"

echo
echo "=== Adding everything under $SCOPE_PATH ==="
git add -A "$SCOPE_PATH"

# Unstage any accidental .DS_Store files
git reset -q -- "**/.DS_Store" 2>/dev/null || true

echo
echo "=== Changes to be committed ==="
git status --short -- "$SCOPE_PATH"

# Exit cleanly if nothing changed under target path
if git diff --cached --quiet -- "$SCOPE_PATH"; then
    echo
    echo "Nothing changed under $SCOPE_PATH. Nothing to commit."
    exit 0
fi

echo
MESSAGE="$FOLDER_NAME update $(date '+%Y-%m-%d %H:%M:%S')"
git commit -m "$MESSAGE" -- "$SCOPE_PATH"

echo
echo "=== Pushing to GitHub ==="
git push origin main

echo
echo "=== Done ==="
git status --short