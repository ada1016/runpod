#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------
# Frida TypeScript Build Helper
#
# Expected location:
#   ~/Documents/runpod/frida/build.sh
#
# Usage:
#   ./build.sh <project_name> <source.ts>
#
# Examples:
#   ./build.sh ls ~/Downloads/legendsummoner-hooks.ts
#   ./build.sh wd ~/Documents/runpod/wd/index.ts
#
# Behavior:
#   - Source under ~/Downloads:
#       Move it to ~/Documents/runpod/<project_name>/,
#       then compile it there.
#
#   - Source anywhere else:
#       Compile it directly in its current directory.
#
# Frida compiler:
#   ~/Documents/frida-js-tools/node_modules/.bin/frida-compile
# --------------------------------------------------

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <project_name> <source.ts>" >&2
    echo >&2
    echo "Examples:" >&2
    echo "  $0 ls ~/Downloads/legendsummoner-hooks.ts" >&2
    echo "  $0 wd ~/Documents/runpod/wd/index.ts" >&2
    exit 1
fi

PROJECT_NAME="$1"
INPUT_PATH="$2"

# Directory containing build.sh:
#   ~/Documents/runpod/frida
SCRIPT_DIR="$(
    cd "$(dirname "${BASH_SOURCE[0]}")"
    pwd
)"

# Parent directory:
#   ~/Documents/runpod
RUNPOD_ROOT="$(
    cd "$SCRIPT_DIR/.."
    pwd
)"

DOWNLOAD_DIR="$HOME/Downloads"
TOOLS_ROOT="${FRIDA_TOOLS_ROOT:-$HOME/Documents/frida-js-tools}"

FRIDA_COMPILER="$TOOLS_ROOT/node_modules/.bin/frida-compile"
NODE_MODULES="$TOOLS_ROOT/node_modules"

# --------------------------------------------------
# Validate input
# --------------------------------------------------

if [[ ! "$PROJECT_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "[-] Invalid project name: $PROJECT_NAME" >&2
    echo "    Allowed: letters, numbers, dot, underscore and dash." >&2
    exit 1
fi

if [[ ! -f "$INPUT_PATH" ]]; then
    echo "[-] Source file not found:" >&2
    echo "    $INPUT_PATH" >&2
    exit 1
fi

if [[ ! -x "$FRIDA_COMPILER" ]]; then
    echo "[-] Frida compiler not found:" >&2
    echo "    $FRIDA_COMPILER" >&2
    echo >&2
    echo "Run the installer first:" >&2
    echo "    $SCRIPT_DIR/install-frida-environment.sh" >&2
    exit 1
fi

# Resolve the source to an absolute path.
SOURCE_DIR="$(
    cd "$(dirname "$INPUT_PATH")"
    pwd
)"

SOURCE_ABS="$SOURCE_DIR/$(basename "$INPUT_PATH")"
FILENAME="$(basename "$SOURCE_ABS")"

if [[ "$FILENAME" != *.ts ]]; then
    echo "[-] Source file must have a .ts extension:" >&2
    echo "    $FILENAME" >&2
    exit 1
fi

# --------------------------------------------------
# Determine build location
# --------------------------------------------------

if [[ "$SOURCE_ABS" == "$DOWNLOAD_DIR/"* ]]; then
    PROJECT_DIR="$RUNPOD_ROOT/$PROJECT_NAME"
    mkdir -p "$PROJECT_DIR"

    BUILD_INPUT="$PROJECT_DIR/$FILENAME"

    echo "[+] Source is under Downloads"
    echo "[+] Moving:"
    echo "    $SOURCE_ABS"
    echo " -> $BUILD_INPUT"

    mv "$SOURCE_ABS" "$BUILD_INPUT"

    BUILD_DIR="$PROJECT_DIR"
else
    BUILD_INPUT="$SOURCE_ABS"
    BUILD_DIR="$(dirname "$SOURCE_ABS")"

    echo "[+] Source is outside Downloads"
    echo "[+] Building directly in its current directory"
fi

BASE_NAME="${FILENAME%.ts}"
OUTPUT_JS="$BUILD_DIR/$BASE_NAME.js"

# --------------------------------------------------
# Compile
# --------------------------------------------------

echo
echo "======================================"
echo " Frida TypeScript Build"
echo "======================================"
echo "[+] Project:      $PROJECT_NAME"
echo "[+] Runpod root:  $RUNPOD_ROOT"
echo "[+] Source:       $BUILD_INPUT"
echo "[+] Output:       $OUTPUT_JS"
echo "[+] Compiler:     $FRIDA_COMPILER"
echo "======================================"
echo

cd "$BUILD_DIR"

# NODE_PATH allows imports such as:
#   import "frida-il2cpp-bridge";
#
# to resolve from the isolated tools directory without putting node_modules
# inside the Git project.
NODE_PATH="$NODE_MODULES${NODE_PATH:+:$NODE_PATH}" \
    "$FRIDA_COMPILER" \
    "$BUILD_INPUT" \
    --output "$OUTPUT_JS" \
    --compress

echo
echo "======================================"
echo "[+] Build successful"
echo "[+] Source TS: $BUILD_INPUT"
echo "[+] Output JS: $OUTPUT_JS"
echo "======================================"