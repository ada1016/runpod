#!/bin/bash
set -euo pipefail

SRC="$HOME/Documents/runpod/tab5/esphome/"
DST="$HOME/esphome/"

echo "Syncing Tab5 source..."
echo "Source: $SRC"
echo "Target: $DST"

if [ ! -d "$SRC" ]; then
  echo "ERROR: source folder does not exist:"
  echo "  $SRC"
  exit 1
fi

mkdir -p "$DST"

rsync -avh --delete \
  --exclude=".esphome/" \
  --exclude=".git/" \
  --exclude=".DS_Store" \
  "$SRC" "$DST"

echo
echo "Sync complete."