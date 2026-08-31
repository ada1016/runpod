#!/bin/bash

set -e

# --------------------------------------------------
# Frida TypeScript build helper
#
# Usage:
#   ./build.sh filename.ts
#
# Example:
#   ./build.sh index.ts
#
# It will:
#   1. Move ~/Downloads/filename.ts -> ~/Documents/runpd/wd/
#   2. Activate ~/frida-env
#   3. Compile filename.ts -> index.js
# --------------------------------------------------

WORK_DIR="$HOME/Documents/runpod/wd"
DOWNLOAD_DIR="$HOME/Downloads"
FRIDA_ENV="$HOME/frida-env/bin/activate"

if [ -z "$1" ]; then
    echo "Usage: $0 <filename>"
    echo
    echo "Example:"
    echo "  $0 index.ts"
    exit 1
fi

FILE="$(basename "$1")"
SOURCE="$DOWNLOAD_DIR/$FILE"
DEST="$WORK_DIR/$FILE"

echo "======================================"
echo " Frida Build"
echo "======================================"
echo "[+] File: $FILE"

# 1. Make sure working directory exists
mkdir -p "$WORK_DIR"

# Move file from Downloads
if [ -f "$SOURCE" ]; then
    echo "[+] Moving:"
    echo "    $SOURCE"
    echo " -> $DEST"

    mv "$SOURCE" "$DEST"
else
    # Allow recompiling an existing file already in wd
    if [ -f "$DEST" ]; then
        echo "[*] File not found in Downloads."
        echo "[+] Using existing:"
        echo "    $DEST"
    else
        echo "[-] File not found:"
        echo "    $SOURCE"
        echo "[-] Also not found:"
        echo "    $DEST"
        #exit 1
    fi
fi

# 2. Activate Frida Python environment
if [ ! -f "$FRIDA_ENV" ]; then
    echo "[-] Frida environment not found:"
    echo "    $FRIDA_ENV"
    exit 1
fi

echo "[+] Activating frida-env"
source "$FRIDA_ENV"

echo "[+] Python: $(which python)"
echo "[+] Frida:  $(which frida)"

# Enter WD project
cd "$WORK_DIR"

# 3. Compile
echo "[+] Compiling $FILE -> index.js"

npx frida-compile "$FILE" \
    --output index.js \
    --compress

echo
echo "======================================"
echo "[+] Build successful"
echo "[+] Output: $WORK_DIR/index.js"
echo "======================================"