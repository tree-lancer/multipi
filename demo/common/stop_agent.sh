#!/usr/bin/env bash
# Find the real `pi` child process of an `expect` wrapper pid spawned by
# spawn_agent.sh, and send it SIGTERM (then SIGKILL if it doesn't exit),
# so pi's session_shutdown handler runs and flushes wakeup-metrics.jsonl.
# Falls back to killing the expect pid itself if no pi child is found.
#
# Usage: stop_agent.sh <expect-pid> [grace-seconds]
set -uo pipefail

EXPECT_PID="$1"
GRACE="${2:-8}"

if [ -z "$EXPECT_PID" ] || ! kill -0 "$EXPECT_PID" >/dev/null 2>&1; then
	exit 0
fi

PI_PID="$(pgrep -P "$EXPECT_PID" -f '(^|/)pi( |$)' 2>/dev/null | head -1)"
if [ -z "$PI_PID" ]; then
	PI_PID="$(pgrep -P "$EXPECT_PID" 2>/dev/null | head -1)"
fi

TARGET="${PI_PID:-$EXPECT_PID}"

kill -TERM "$TARGET" >/dev/null 2>&1 || true
waited=0
while [ "$waited" -lt "$GRACE" ] && kill -0 "$EXPECT_PID" >/dev/null 2>&1; do
	sleep 1
	waited=$((waited + 1))
done

if kill -0 "$EXPECT_PID" >/dev/null 2>&1; then
	kill -KILL "$TARGET" >/dev/null 2>&1 || true
	kill -KILL "$EXPECT_PID" >/dev/null 2>&1 || true
fi

exit 0
