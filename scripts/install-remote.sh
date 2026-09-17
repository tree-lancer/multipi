#!/bin/sh
# Install multipi from a GitHub Release. Safe to run with: curl -fsSL ... | sh
set -eu

REPOSITORY="tree-lancer/multipi"
VERSION="${MULTIPI_VERSION:-latest}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s\n' "error: required command not found: $1" >&2
    exit 1
  fi
}

install_pi() {
  printf '%s\n' "pi was not found; installing pi..."
  curl -fsSL https://pi.dev/install.sh | sh

  # The installer may have added pi to a shell profile rather than this process.
  # Check common user-local locations before asking the user to open a new shell.
  for candidate in "$HOME/.local/bin/pi" "$HOME/.pi/bin/pi"; do
    if [ -x "$candidate" ]; then
      PATH="$(dirname "$candidate"):$PATH"
      export PATH
      break
    fi
  done

  if ! pi --version >/dev/null 2>&1; then
    printf '%s\n' "error: pi was installed but is not on PATH yet. Open a new shell, then rerun this installer." >&2
    exit 1
  fi
}

require_command curl
require_command tar
require_command mktemp
require_command bash

if pi --version >/dev/null 2>&1; then
  printf 'Found pi: %s\n' "$(pi --version 2>&1)"
else
  install_pi
fi

if [ "$VERSION" = "latest" ]; then
  ASSET_URL="https://github.com/$REPOSITORY/releases/latest/download/multipi.tar.gz"
else
  ASSET_URL="https://github.com/$REPOSITORY/releases/download/$VERSION/multipi.tar.gz"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/multipi-install.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT HUP INT TERM

printf 'Downloading multipi release (%s)...\n' "$VERSION"
curl -fL --retry 3 --retry-delay 1 -o "$TMP_DIR/multipi.tar.gz" "$ASSET_URL"
tar -xzf "$TMP_DIR/multipi.tar.gz" -C "$TMP_DIR"

RELEASE_DIR="$TMP_DIR/multipi"
if [ ! -x "$RELEASE_DIR/install.sh" ]; then
  printf '%s\n' "error: release asset has an invalid layout; expected multipi/install.sh" >&2
  exit 1
fi

printf '%s\n' "Installing multipi in release mode..."
bash "$RELEASE_DIR/install.sh" --release
printf '%s\n' "multipi installation complete. Restart pi or run /reload, then run 'bus up'."
