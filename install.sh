#!/usr/bin/env bash
set -euo pipefail

MODE="release"
EXT_NAME="multipi"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/$EXT_NAME"
DEST_ROOT="${PI_EXTENSIONS_DIR:-$HOME/.pi/agent/extensions}"
DEST_DIR="$DEST_ROOT/$EXT_NAME"
BUS_BIN_DIR="${PI_BUS_BIN_DIR:-$HOME/.local/bin}"
BUS_BIN="$BUS_BIN_DIR/bus"

usage() {
  cat <<'USAGE'
Usage: ./install.sh [--release|--dev] [--dest DIR] [--bin-dir DIR]

Options:
  --release      Copy the extension into pi's extension directory. This is the default.
  --dev          Symlink the extension directory for development and hot editing.
  --dest DIR     Override the pi extension directory. Default: ~/.pi/agent/extensions
  --bin-dir DIR  Directory for the bus command wrapper. Default: ~/.local/bin
  -h, --help     Show this help.

Examples:
  ./install.sh
  ./install.sh --release
  ./install.sh --dev
  ./install.sh --dev --dest ./.pi/extensions
  ./install.sh --release --bin-dir ./bin
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      MODE="release"
      shift
      ;;
    --dev)
      MODE="dev"
      shift
      ;;
    --dest)
      [[ $# -ge 2 ]] || { echo "error: --dest requires a directory" >&2; exit 2; }
      DEST_ROOT="$2"
      DEST_DIR="$DEST_ROOT/$EXT_NAME"
      shift 2
      ;;
    --bin-dir)
      [[ $# -ge 2 ]] || { echo "error: --bin-dir requires a directory" >&2; exit 2; }
      BUS_BIN_DIR="$2"
      BUS_BIN="$BUS_BIN_DIR/bus"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -d "$SRC_DIR" ]]; then
  echo "error: source directory not found: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$DEST_ROOT" "$BUS_BIN_DIR"

case "$MODE" in
  dev)
    rm -rf "$DEST_DIR"
    ln -s "$SRC_DIR" "$DEST_DIR"
    rm -f "$BUS_BIN"
    ln -s "$SRC_DIR/service/bin/bus" "$BUS_BIN"
    echo "Installed in development mode: $DEST_DIR -> $SRC_DIR"
    echo "Installed bus command: $BUS_BIN -> $SRC_DIR/service/bin/bus"
    ;;
  release)
    rm -rf "$DEST_DIR"
    mkdir -p "$DEST_DIR"
    tar -C "$SRC_DIR" --exclude='node_modules' --exclude='.git' -cf - . | tar -C "$DEST_DIR" -xf -
    cat > "$BUS_BIN" <<EOF
#!/usr/bin/env bash
exec node "$DEST_DIR/service/bin/bus" "\$@"
EOF
    chmod +x "$BUS_BIN"
    echo "Installed in release mode: $DEST_DIR"
    echo "Installed bus command: $BUS_BIN"
    ;;
  *)
    echo "error: invalid mode: $MODE" >&2
    exit 2
    ;;
esac

echo "Run 'bus up' to start the sqlite-backed bus service."
echo "Restart pi or run /reload to load the extension."
