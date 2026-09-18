#!/usr/bin/env bash
# Spawn one long-lived, non-interactive pi agent under a pseudo-TTY (via
# expect), so its wait_bus() background listener survives without a real
# terminal attached. Prints the expect process's pid to stdout on success.
#
# Usage:
#   spawn_agent.sh <work-dir> <prompt-file> <log-file> <pid-file> \
#     <extension-entry> <bus-url> [extra-env-KEY=VALUE ...]
set -euo pipefail

WORK_DIR="$1"
PROMPT_FILE="$2"
LOG_FILE="$3"
PID_FILE="$4"
EXTENSION_ENTRY="$5"
BUS_URL="$6"
shift 6

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECT_SCRIPT="$WORK_DIR/spawn.exp"

mkdir -p "$WORK_DIR"

ENV_PREFIX=(env "PI_BUS_URL=$BUS_URL")
for kv in "$@"; do
	ENV_PREFIX+=("$kv")
done

python3 "$COMMON_DIR/gen_expect_script.py" \
	"$EXPECT_SCRIPT" "$PROMPT_FILE" -- \
	"${ENV_PREFIX[@]}" pi --no-session -e "$EXTENSION_ENTRY"

(
	cd "$WORK_DIR"
	nohup expect "$EXPECT_SCRIPT" >"$LOG_FILE" 2>&1 &
	echo $! >"$PID_FILE"
)

# nohup backgrounding above runs in a subshell; read back the pid it wrote.
sleep 0.2
cat "$PID_FILE"
