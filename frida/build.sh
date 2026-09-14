#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 2 ]] || { echo "Usage: $0 <project_name> <source.ts>" >&2; exit 1; }

PROJECT_NAME="$1"
INPUT_PATH="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNPAD_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOLS_ROOT="${FRIDA_TOOLS_ROOT:-$HOME/Documents/frida-js-tools}"
DOWNLOAD_DIR="$HOME/Downloads"
FRIDA_COMPILER="$TOOLS_ROOT/node_modules/.bin/frida-compile"

[[ "$PROJECT_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "[-] Invalid project name: $PROJECT_NAME" >&2; exit 1; }
[[ -f "$INPUT_PATH" ]] || { echo "[-] Source file not found: $INPUT_PATH" >&2; exit 1; }
[[ -x "$FRIDA_COMPILER" ]] || { echo "[-] Compiler missing. Run $SCRIPT_DIR/install-frida-environment.sh" >&2; exit 1; }

SOURCE_ABS="$(cd "$(dirname "$INPUT_PATH")" && pwd)/$(basename "$INPUT_PATH")"
FILENAME="$(basename "$SOURCE_ABS")"
[[ "$FILENAME" == *.ts ]] || { echo "[-] Source must be a .ts file: $FILENAME" >&2; exit 1; }

if [[ "$SOURCE_ABS" == "$DOWNLOAD_DIR/"* ]]; then
    BUILD_DIR="$RUNPAD_ROOT/$PROJECT_NAME"
    mkdir -p "$BUILD_DIR"
    BUILD_INPUT="$BUILD_DIR/$FILENAME"
    echo "[+] Moving downloaded source to: $BUILD_INPUT"
    mv "$SOURCE_ABS" "$BUILD_INPUT"
else
    BUILD_DIR="$(dirname "$SOURCE_ABS")"
    BUILD_INPUT="$SOURCE_ABS"
    echo "[+] Building source in place: $BUILD_INPUT"
fi

BASE_NAME="${FILENAME%.ts}"
OUTPUT_JS="$BUILD_DIR/$BASE_NAME.js"
PROJECT_NODE_MODULES="$BUILD_DIR/node_modules"
TEMP_NODE_MODULES_LINK=""

cleanup() {
    if [[ -n "$TEMP_NODE_MODULES_LINK" && -L "$TEMP_NODE_MODULES_LINK" ]]; then
        rm "$TEMP_NODE_MODULES_LINK"
    fi
}
trap cleanup EXIT INT TERM

# frida-compile/esbuild resolves package imports from the source directory's
# ancestor tree and does not reliably honor NODE_PATH for bundling. Provide
# the centralized dependencies through a temporary project-local symlink.
if [[ ! -e "$PROJECT_NODE_MODULES" && ! -L "$PROJECT_NODE_MODULES" ]]; then
    ln -s "$TOOLS_ROOT/node_modules" "$PROJECT_NODE_MODULES"
    TEMP_NODE_MODULES_LINK="$PROJECT_NODE_MODULES"
    echo "[+] Module link: $PROJECT_NODE_MODULES -> $TOOLS_ROOT/node_modules (temporary)"
fi

echo "[+] Project:  $PROJECT_NAME"
echo "[+] Compiler: $FRIDA_COMPILER"
echo "[+] Output:   $OUTPUT_JS"

cd "$BUILD_DIR"
NODE_PATH="$TOOLS_ROOT/node_modules${NODE_PATH:+:$NODE_PATH}" \
    "$FRIDA_COMPILER" "$BUILD_INPUT" --output "$OUTPUT_JS" --compress

echo "[+] Build successful: $OUTPUT_JS"
