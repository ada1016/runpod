#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------
# Determine Git Root
# ---------------------------------------------------------
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$GIT_ROOT" ]]; then
    echo "Error: Not inside a Git repository." >&2
    exit 1
fi

cd "$GIT_ROOT"

# ---------------------------------------------------------
# Determine Target Directory
# ---------------------------------------------------------
if [[ $# -ge 1 ]]; then
    TARGET_DIR="$1"
    if [[ ! -d "$TARGET_DIR" ]]; then
        echo "Error: Directory '$TARGET_DIR' does not exist." >&2
        exit 1
    fi
    TARGET_ABS="$(cd "$TARGET_DIR" && pwd)"
    TARGET_REL="${TARGET_ABS#"$GIT_ROOT"}"
    TARGET_REL="${TARGET_REL#/}"
    
    if [[ -n "$TARGET_REL" ]]; then
        SCOPE_PATH="${TARGET_REL%/}/"
    else
        SCOPE_PATH="."
    fi
else
    # Default to entire repo if run without arguments
    SCOPE_PATH="."
fi

# ---------------------------------------------------------
# Fetch latest remote state
# ---------------------------------------------------------
echo "=== Fetching latest from origin/main ==="
git fetch origin main

# ---------------------------------------------------------
# Overwrite local target with origin/main
# ---------------------------------------------------------
if [[ "$SCOPE_PATH" == "." ]]; then
    echo "=== Force resetting ENTIRE repository to origin/main ==="
    git reset --hard origin/main
    git clean -fd
else
    echo "=== Force resetting '$SCOPE_PATH' to origin/main ==="
    # Overwrite tracked files in the target directory with remote version
    git checkout origin/main -- "$SCOPE_PATH"
    # Remove untracked files/folders created locally inside the target directory
    git clean -fd "$SCOPE_PATH"
fi

echo
echo "=== Done ==="
git status --short -- "$SCOPE_PATH"