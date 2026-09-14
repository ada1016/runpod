#!/bin/bash
set -euo pipefail

# 1. Determine script directory and working target
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find the repository root dynamically
GIT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$GIT_ROOT" ]]; then
    echo "Error: Not inside a Git repository." >&2
    exit 1
fi

# 2. Identify the target folder relative to the git root
# If run from inside a subfolder (e.g., 'wd' or 'ls'), TARGET becomes 'wd/' or 'ls/'
TARGET_PATH="$(git -C "$PWD" rev-parse --show-prefix 2>/dev/null || true)"

# Fallback: if invoked directly from the script's directory
if [[ -z "$TARGET_PATH" && "$SCRIPT_DIR" != "$GIT_ROOT" ]]; then
    TARGET_PATH="$(git -C "$SCRIPT_DIR" rev-parse --show-prefix 2>/dev/null || true)"
fi

# Ensure trailing slash if a target subdirectory exists
[[ -n "$TARGET_PATH" && "$TARGET_PATH" != */ ]] && TARGET_PATH="${TARGET_PATH}/"

# Folder label for the commit message (e.g., 'wd' -> 'WD', root -> 'ROOT')
if [[ -n "$TARGET_PATH" ]]; then
    FOLDER_NAME="$(basename "$TARGET_PATH" | tr '[:lower:]' '[:upper:]')"
    SCOPE_PATH="$TARGET_PATH"
else
    FOLDER_NAME="ROOT"
    SCOPE_PATH="."
fi

# 3. Navigate to repository root for consistent git operations
cd "$GIT_ROOT"

echo "=== Git Root: $GIT_ROOT ==="
echo "=== Target Directory: ${TARGET_PATH:-./} ==="

echo
echo "=== Current Git status ==="
git status --short -- "$SCOPE_PATH"

echo
echo "=== Adding everything under $SCOPE_PATH ==="
git add -A "$SCOPE_PATH"

echo
echo "=== Changes to be committed ==="
git status --short -- "$SCOPE_PATH"

# Stop if nothing changed under the target directory
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