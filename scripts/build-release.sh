#!/usr/bin/env bash
# Build the GitHub Release asset consumed by scripts/install-remote.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/multipi-release.XXXXXX")"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$OUT_DIR" "$STAGE_DIR/multipi"
tar -C "$ROOT" \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='multipi/node_modules' \
  --exclude='multipi/service/node_modules' \
  --exclude='multipi/ext/dashboard' \
  -cf - LICENSE README.md install.sh multipi \
  | tar -C "$STAGE_DIR/multipi" -xf -

tar -C "$STAGE_DIR" -czf "$OUT_DIR/multipi.tar.gz" multipi
shasum -a 256 "$OUT_DIR/multipi.tar.gz" > "$OUT_DIR/multipi.tar.gz.sha256"
printf 'Created %s\n' "$OUT_DIR/multipi.tar.gz"
printf 'Created %s\n' "$OUT_DIR/multipi.tar.gz.sha256"
