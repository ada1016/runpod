#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_ROOT="${FRIDA_TOOLS_ROOT:-$HOME/Documents/frida-js-tools}"
PYTHON_ENV="$TOOLS_ROOT/python-env"

find_python() {
    local candidate
    for candidate in python3.13 python3.12 python3.11 python3; do
        command -v "$candidate" >/dev/null 2>&1 || continue
        if [[ "$($candidate -c 'import sys; print(int(sys.version_info >= (3, 11)))')" == "1" ]]; then
            command -v "$candidate"
            return 0
        fi
    done
    return 1
}

command -v node >/dev/null 2>&1 || { echo "[-] Node.js missing. Install with: brew install node" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "[-] npm is missing." >&2; exit 1; }
PYTHON_BIN="$(find_python)" || { echo "[-] Python 3.11+ missing. Install with: brew install python@3.12" >&2; exit 1; }

echo "[+] Tools root: $TOOLS_ROOT"
echo "[+] Node:       $(node --version)"
echo "[+] Python:     $($PYTHON_BIN --version 2>&1)"

mkdir -p "$TOOLS_ROOT"

if [[ -x "$PYTHON_ENV/bin/python" ]] && [[ "$($PYTHON_ENV/bin/python -c 'import sys; print(int(sys.version_info >= (3, 11)))')" != "1" ]]; then
    BACKUP="${PYTHON_ENV}.backup-$(date +%Y%m%d-%H%M%S)"
    echo "[+] Preserving incompatible old environment as: $BACKUP"
    mv "$PYTHON_ENV" "$BACKUP"
fi

[[ -x "$PYTHON_ENV/bin/python" ]] || "$PYTHON_BIN" -m venv "$PYTHON_ENV"
"$PYTHON_ENV/bin/python" -m pip install --upgrade pip frida-tools

cd "$TOOLS_ROOT"
[[ -f package.json ]] || npm init -y >/dev/null
npm install --save-exact frida-compile frida-il2cpp-bridge

chmod +x "$SCRIPT_DIR/build.sh" "$SCRIPT_DIR/hook.sh" "$0" 2>/dev/null || true
[[ -x "$TOOLS_ROOT/node_modules/.bin/frida-compile" ]] || { echo "[-] frida-compile installation failed." >&2; exit 1; }
[[ -x "$PYTHON_ENV/bin/frida" ]] || { echo "[-] Frida CLI installation failed." >&2; exit 1; }

echo "[+] Environment ready"
echo "[+] Build: $SCRIPT_DIR/build.sh <project> <source.ts>"
echo "[+] Hook:  $SCRIPT_DIR/hook.sh <script.js>"
