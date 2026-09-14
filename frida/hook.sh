#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <script.js>" >&2
    echo "Example: $0 ~/Documents/runpod/ls/legendsummoner-hooks.js" >&2
    exit 1
fi

INPUT_SCRIPT="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_ROOT="${FRIDA_TOOLS_ROOT:-$HOME/Documents/frida-js-tools}"
FRIDA="$TOOLS_ROOT/python-env/bin/frida"
FRIDA_PS="$TOOLS_ROOT/python-env/bin/frida-ps"
PYTHON="$TOOLS_ROOT/python-env/bin/python"

[[ -x "$FRIDA" && -x "$FRIDA_PS" && -x "$PYTHON" ]] || {
    echo "[-] Frida environment missing." >&2
    echo "[*] Run: $SCRIPT_DIR/install-frida-environment.sh" >&2
    exit 1
}

[[ -f "$INPUT_SCRIPT" ]] || {
    echo "[-] JavaScript file not found: $INPUT_SCRIPT" >&2
    exit 1
}

SCRIPT_ABS="$(cd "$(dirname "$INPUT_SCRIPT")" && pwd)/$(basename "$INPUT_SCRIPT")"
PROJECT_DIR="$(dirname "$SCRIPT_ABS")"
HOOK_CONFIG="$PROJECT_DIR/hook_pid.json"

[[ -f "$HOOK_CONFIG" ]] || {
    echo "[-] Project hook configuration not found: $HOOK_CONFIG" >&2
    exit 1
}

CANDIDATES="$("$PYTHON" - "$HOOK_CONFIG" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as stream:
        config = json.load(stream)
except (OSError, ValueError) as exc:
    print(f"Invalid hook_pid.json: {exc}", file=sys.stderr)
    raise SystemExit(2)

names = config.get("process_names")
if not isinstance(names, list) or not names or not all(
    isinstance(name, str) and name.strip() for name in names
):
    print("hook_pid.json requires a non-empty process_names string array", file=sys.stderr)
    raise SystemExit(2)

hooks = config.get("default_hook", [])
if not isinstance(hooks, list) or not all(
    isinstance(command, str) and command.strip() for command in hooks
):
    print("hook_pid.json default_hook must be a string array", file=sys.stderr)
    raise SystemExit(2)

print("\n".join(names))
PY
)"

PROCESS_LIST="$("$FRIDA_PS")"
MATCHES="$(printf '%s\n' "$PROCESS_LIST" |
    "$PYTHON" -c '
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    names = json.load(stream)["process_names"]

priority = {name: index for index, name in enumerate(names)}
matches = []

for line in sys.stdin:
    match = re.match(r"^\s*(\d+)\s+(.+?)\s*$", line)
    if not match:
        continue
    pid = int(match.group(1))
    name = match.group(2)
    if name in priority:
        matches.append((priority[name], pid, name))

for _, pid, name in sorted(matches):
    print(f"{pid}\t{name}")
' "$HOOK_CONFIG")"

if [[ -z "$MATCHES" ]]; then
    echo "[-] No running process matched names from: $HOOK_CONFIG" >&2
    echo "[*] Configured process names:" >&2
    printf '%s\n' "$CANDIDATES" | sed 's/^/    /' >&2
    echo "[*] Running processes are listed by: $FRIDA_PS" >&2
    exit 1
fi

echo "[+] Matching processes:"
printf '%s\n' "$MATCHES" |
    awk -F '\t' '{ printf "    PID %-8s %s\n", $1, $2 }'

PID="$(printf '%s\n' "$MATCHES" | awk -F '\t' 'NR == 1 { print $1 }')"
PROCESS_NAME="$(printf '%s\n' "$MATCHES" | awk -F '\t' 'NR == 1 { print $2 }')"

FRIDA_ARGS=(-p "$PID" -l "$SCRIPT_ABS")
DEFAULT_HOOKS=()

while IFS= read -r command; do
    [[ -n "$command" ]] || continue
    DEFAULT_HOOKS+=("$command")
    FRIDA_ARGS+=(-e "$command")
done < <("$PYTHON" - "$HOOK_CONFIG" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    config = json.load(stream)

for command in config.get("default_hook", []):
    print(command)
PY
)

echo "[+] Config:  $HOOK_CONFIG"
echo "[+] Target:  $PROCESS_NAME"
echo "[+] PID:     $PID"
echo "[+] Script:  $SCRIPT_ABS"

if [[ ${#DEFAULT_HOOKS[@]} -gt 0 ]]; then
    echo "[+] Default hooks:"
    printf '    %s\n' "${DEFAULT_HOOKS[@]}"
else
    echo "[*] No default hooks configured"
fi

exec sudo "$FRIDA" "${FRIDA_ARGS[@]}"
