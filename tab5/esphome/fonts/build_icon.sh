#!/bin/bash

set -euo pipefail

# ============================================================
# Tab5 Material Symbols Font Builder
#
# Usage:
#   ./build_icons.sh /path/to/MaterialSymbols....ttf
#
# Reads:
#   icons.txt
#
# icons.txt format:
#   icon_name codepoint
#
# Example:
#   water_drop E798
#   wifi_home F671
#   light_group_2 FFF76
#
# Blank lines and lines beginning with # are ignored.
#
# Outputs:
#   tab5_icons.ttf
#   preview.html
# ============================================================


# ------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------

PYTHON="/opt/homebrew/bin/python3.11"

# Material Symbols appearance
FILL_VALUE=0
GRAD_VALUE=0
OPSZ_VALUE=24
WGHT_VALUE=400


# ------------------------------------------------------------
# PATHS
# ------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ICON_FILE="$SCRIPT_DIR/icons.txt"

FIXED_FONT="$SCRIPT_DIR/.material_symbols_fixed.ttf"
OUTPUT_FONT="$SCRIPT_DIR/tab5_icons.ttf"
PREVIEW_HTML="$SCRIPT_DIR/preview.html"


# ------------------------------------------------------------
# ARGUMENT CHECK
# ------------------------------------------------------------

if [ "$#" -ne 1 ]; then
    echo
    echo "Usage:"
    echo "  $0 /path/to/MaterialSymbols.ttf"
    echo
    exit 1
fi

SOURCE_FONT="$1"

# Convert relative path to absolute path
if [[ "$SOURCE_FONT" != /* ]]; then
    SOURCE_FONT="$(cd "$(dirname "$SOURCE_FONT")" && pwd)/$(basename "$SOURCE_FONT")"
fi


# ------------------------------------------------------------
# CHECK REQUIREMENTS
# ------------------------------------------------------------

echo
echo "=============================================="
echo " Tab5 Material Symbols Font Builder"
echo "=============================================="
echo

if [ ! -x "$PYTHON" ]; then
    echo "ERROR: Python not found:"
    echo "  $PYTHON"
    exit 1
fi

if [ ! -f "$SOURCE_FONT" ]; then
    echo "ERROR: Source font not found:"
    echo "  $SOURCE_FONT"
    exit 1
fi

if [ ! -f "$ICON_FILE" ]; then
    echo "ERROR: icons.txt not found:"
    echo "  $ICON_FILE"
    exit 1
fi

# Check FontTools
if ! "$PYTHON" -c "import fontTools" >/dev/null 2>&1; then
    echo "ERROR: FontTools is not installed."
    echo
    echo "Install it with:"
    echo "  $PYTHON -m pip install fonttools brotli"
    exit 1
fi

echo "Python:"
"$PYTHON" --version

echo
echo "Source font:"
echo "  $SOURCE_FONT"

echo
echo "Icon manifest:"
echo "  $ICON_FILE"

echo


# ------------------------------------------------------------
# READ icons.txt
# ------------------------------------------------------------

UNICODES=""
ICON_COUNT=0

while read -r name code extra; do

    # Ignore blank lines
    [[ -z "${name:-}" ]] && continue

    # Ignore comments
    [[ "$name" == \#* ]] && continue

    if [ -z "${code:-}" ]; then
        echo "ERROR: Missing codepoint for:"
        echo "  $name"
        exit 1
    fi

    # Accept:
    # E798
    # U+E798
    # 0xE798

    code="${code#U+}"
    code="${code#u+}"
    code="${code#0x}"
    code="${code#0X}"

    code="$(echo "$code" | tr '[:lower:]' '[:upper:]')"

    if [[ ! "$code" =~ ^[0-9A-F]+$ ]]; then
        echo "ERROR: Invalid codepoint:"
        echo "  $name $code"
        exit 1
    fi

    if [ -z "$UNICODES" ]; then
        UNICODES="U+$code"
    else
        UNICODES="$UNICODES,U+$code"
    fi

    ICON_COUNT=$((ICON_COUNT + 1))

done < "$ICON_FILE"


if [ "$ICON_COUNT" -eq 0 ]; then
    echo "ERROR: No icons found in icons.txt"
    exit 1
fi


# ------------------------------------------------------------
# DISPLAY MANIFEST
# ------------------------------------------------------------

echo "Icons selected: $ICON_COUNT"
echo

printf "%-30s %s\n" "ICON" "CODEPOINT"
printf "%-30s %s\n" "------------------------------" "---------"

while read -r name code extra; do

    [[ -z "${name:-}" ]] && continue
    [[ "$name" == \#* ]] && continue

    code="${code#U+}"
    code="${code#u+}"
    code="${code#0x}"
    code="${code#0X}"

    code="$(echo "$code" | tr '[:lower:]' '[:upper:]')"

    printf "%-30s U+%s\n" "$name" "$code"

done < "$ICON_FILE"

echo


# ------------------------------------------------------------
# STEP 1 — FREEZE VARIABLE FONT
# ------------------------------------------------------------

echo "----------------------------------------------"
echo "Step 1/4: Freezing Material Symbols axes"
echo "----------------------------------------------"

echo
echo "  FILL = $FILL_VALUE"
echo "  GRAD = $GRAD_VALUE"
echo "  opsz = $OPSZ_VALUE"
echo "  wght = $WGHT_VALUE"
echo

rm -f "$FIXED_FONT"

"$PYTHON" -m fontTools.varLib.instancer \
    "$SOURCE_FONT" \
    FILL="$FILL_VALUE" \
    GRAD="$GRAD_VALUE" \
    opsz="$OPSZ_VALUE" \
    wght="$WGHT_VALUE" \
    --output "$FIXED_FONT"

if [ ! -f "$FIXED_FONT" ]; then
    echo "ERROR: Failed to create fixed font."
    exit 1
fi

echo
echo "Fixed font created."
echo


# ------------------------------------------------------------
# STEP 2 — CREATE SUBSET
# ------------------------------------------------------------

echo "----------------------------------------------"
echo "Step 2/4: Creating subset font"
echo "----------------------------------------------"
echo

rm -f "$OUTPUT_FONT"

"$PYTHON" -m fontTools.subset \
    "$FIXED_FONT" \
    --unicodes="$UNICODES" \
    --output-file="$OUTPUT_FONT"

if [ ! -f "$OUTPUT_FONT" ]; then
    echo "ERROR: Failed to create subset font."
    exit 1
fi

echo
echo "Subset created:"
echo "  $OUTPUT_FONT"
echo


# ------------------------------------------------------------
# STEP 3 — VERIFY GLYPHS
# ------------------------------------------------------------

echo "----------------------------------------------"
echo "Step 3/4: Verifying subset"
echo "----------------------------------------------"
echo

"$PYTHON" - "$OUTPUT_FONT" "$ICON_FILE" <<'PY'
import sys
from fontTools.ttLib import TTFont

font_path = sys.argv[1]
manifest_path = sys.argv[2]

font = TTFont(font_path)

available = set()

for table in font["cmap"].tables:
    available.update(table.cmap.keys())

missing = []
count = 0

with open(manifest_path, "r", encoding="utf-8") as f:
    for line in f:

        line = line.strip()

        if not line or line.startswith("#"):
            continue

        parts = line.split()

        if len(parts) < 2:
            continue

        name = parts[0]
        code = parts[1].upper()

        if code.startswith("U+"):
            code = code[2:]
        elif code.startswith("0X"):
            code = code[2:]

        value = int(code, 16)
        count += 1

        if value in available:
            print(f"  OK    {name:<30} U+{code}")
        else:
            print(f"  MISS  {name:<30} U+{code}")
            missing.append((name, code))

font.close()

print()

if missing:
    print(f"ERROR: {len(missing)} requested glyph(s) are missing.")
    sys.exit(2)

print(f"All {count} requested icons verified.")
PY

echo


# ------------------------------------------------------------
# STEP 4 — GENERATE HTML PREVIEW
# ------------------------------------------------------------

echo "----------------------------------------------"
echo "Step 4/4: Generating HTML preview"
echo "----------------------------------------------"
echo

"$PYTHON" - "$ICON_FILE" "$PREVIEW_HTML" <<'PY'
import sys
import html

manifest_path = sys.argv[1]
output_path = sys.argv[2]

icons = []

with open(manifest_path, "r", encoding="utf-8") as f:

    for line in f:

        line = line.strip()

        if not line or line.startswith("#"):
            continue

        parts = line.split()

        if len(parts) < 2:
            continue

        name = parts[0]
        code = parts[1].upper()

        if code.startswith("U+"):
            code = code[2:]
        elif code.startswith("0X"):
            code = code[2:]

        icons.append((name, code))


cards = []

for name, code in icons:

    cards.append(f"""
    <div class="card">

        <div class="icon">
            &#x{code};
        </div>

        <div class="name">
            {html.escape(name)}
        </div>

        <div class="code">
            U+{html.escape(code)}
        </div>

    </div>
    """)


document = f"""<!DOCTYPE html>

<html>

<head>

<meta charset="utf-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1">

<title>Tab5 Icon Font Preview</title>

<style>

@font-face {{
    font-family: "Tab5Icons";
    src: url("tab5_icons.ttf") format("truetype");
}}

* {{
    box-sizing: border-box;
}}

body {{
    margin: 0;
    padding: 40px;

    font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

    background: #f4f4f4;
    color: #222;
}}

.header {{
    margin-bottom: 32px;
}}

h1 {{
    margin: 0 0 8px 0;
    font-size: 30px;
}}

.subtitle {{
    color: #666;
    font-size: 15px;
}}

.grid {{
    display: grid;

    grid-template-columns:
        repeat(auto-fill, minmax(190px, 1fr));

    gap: 18px;
}}

.card {{
    background: white;

    border-radius: 14px;

    padding: 28px 16px 22px;

    text-align: center;

    box-shadow:
        0 2px 8px rgba(0,0,0,0.08);
}}

.icon {{
    font-family: "Tab5Icons";

    font-size: 64px;

    line-height: 1;

    height: 72px;

    display: flex;

    align-items: center;
    justify-content: center;

    margin-bottom: 18px;
}}

.name {{
    font-size: 15px;
    font-weight: 600;

    word-break: break-word;

    margin-bottom: 6px;
}}

.code {{
    font-family:
        SFMono-Regular,
        Consolas,
        monospace;

    color: #777;

    font-size: 13px;
}}

.footer {{
    margin-top: 32px;

    color: #777;

    font-size: 13px;
}}

</style>

</head>


<body>

<div class="header">

    <h1>Tab5 Icon Font</h1>

    <div class="subtitle">
        {len(icons)} icons &bull;
        generated automatically from icons.txt
    </div>

</div>


<div class="grid">

{"".join(cards)}

</div>


<div class="footer">

    Font: tab5_icons.ttf<br>
    Source manifest: icons.txt

</div>

</body>

</html>
"""


with open(output_path, "w", encoding="utf-8") as f:
    f.write(document)

print(f"Preview generated with {len(icons)} icons.")

PY


# ------------------------------------------------------------
# CLEAN INTERMEDIATE FILE
# ------------------------------------------------------------

rm -f "$FIXED_FONT"


# ------------------------------------------------------------
# FINAL RESULTS
# ------------------------------------------------------------

echo
echo "=============================================="
echo " BUILD COMPLETE"
echo "=============================================="
echo

echo "Generated:"
echo
echo "  $OUTPUT_FONT"
echo "  $PREVIEW_HTML"
echo

echo "Font size:"
ls -lh "$OUTPUT_FONT"

echo
echo "Icons: $ICON_COUNT"
echo

echo "To view the preview:"
echo
echo "  open \"$PREVIEW_HTML\""
echo