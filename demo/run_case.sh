#!/usr/bin/env bash
# One-shot entry point to run a multipi demo case end to end:
#   1. start an isolated bus service (own port + sqlite + wakeup-metrics.jsonl)
#   2. spawn one pi agent per case participant, each under a pseudo-TTY so it
#      stays alive without a real terminal (see demo/README.md)
#   3. wait for them to register and interact for a configured duration
#   4. stop everything gracefully so wakeup-metrics.jsonl gets flushed
#   5. analyze the run and print a report
#
# Usage:
#   ./run_case.sh <case-name> [--keep-running] [--duration <seconds>]
#
# Example:
#   ./run_case.sh guess-celebrity-game
set -euo pipefail

DEMO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEMO_ROOT/.." && pwd)"
COMMON_DIR="$DEMO_ROOT/common"
EXTENSION_ENTRY="$REPO_ROOT/multipi/index.ts"
SERVICE_DIR="$REPO_ROOT/multipi/service"

# shellcheck source=./common/lib.sh
source "$COMMON_DIR/lib.sh"

usage() {
	cat <<'USAGE'
Usage: ./run_case.sh <case-name> [options]

Options:
  --duration <seconds>   Override how long to let the case run (default: from case.env)
  --keep-running         Do not stop agents/bus after the run; print how to attach/stop manually
  --port <port>          Bus service port (default: 43900)
  --no-dashboard-bridge  Do not mirror this run into the multipi dashboard, even if it's running
  -h, --help             Show this help

Cases are directories under demo/ containing a case.env file, e.g.:
  ./run_case.sh guess-celebrity-game
USAGE
}

CASE_NAME=""
OVERRIDE_DURATION=""
KEEP_RUNNING=0
BUS_PORT=43900
ENABLE_DASHBOARD_BRIDGE=1

while [ $# -gt 0 ]; do
	case "$1" in
	--duration)
		OVERRIDE_DURATION="$2"
		shift 2
		;;
	--keep-running)
		KEEP_RUNNING=1
		shift
		;;
	--port)
		BUS_PORT="$2"
		shift 2
		;;
	--no-dashboard-bridge)
		ENABLE_DASHBOARD_BRIDGE=0
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	-*)
		demo_err "unknown option: $1"
		usage >&2
		exit 2
		;;
	*)
		if [ -n "$CASE_NAME" ]; then
			demo_err "unexpected extra argument: $1"
			usage >&2
			exit 2
		fi
		CASE_NAME="$1"
		shift
		;;
	esac
done

if [ -z "$CASE_NAME" ]; then
	demo_err "missing <case-name>"
	usage >&2
	exit 2
fi

CASE_DIR="$DEMO_ROOT/$CASE_NAME"
CASE_ENV="$CASE_DIR/case.env"
if [ ! -f "$CASE_ENV" ]; then
	demo_err "case not found: $CASE_ENV"
	exit 1
fi

demo_require_cmd node
demo_require_cmd curl
demo_require_cmd expect
demo_require_cmd python3
demo_require_cmd pi

# shellcheck source=/dev/null
source "$CASE_ENV"

if [ -n "$OVERRIDE_DURATION" ]; then
	CASE_DURATION_SECONDS="$OVERRIDE_DURATION"
fi

if [ "${#CASE_AGENTS[@]}" -eq 0 ] || [ "${#CASE_AGENTS[@]}" -ne "${#CASE_PROMPT_FILES[@]}" ]; then
	demo_err "case.env must define CASE_AGENTS and CASE_PROMPT_FILES with matching length"
	exit 1
fi

RUN_ID="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$DEMO_ROOT/.runs/$CASE_NAME/$RUN_ID"
mkdir -p "$RUN_DIR"

BUS_DATA_DIR="$RUN_DIR/bus"
BUS_URL="http://127.0.0.1:$BUS_PORT"
BUS_DB="$BUS_DATA_DIR/bus.sqlite"
BUS_LOG="$RUN_DIR/bus-service.log"
METRICS_LOG="$RUN_DIR/wakeup-metrics.jsonl"
BUS_PID_FILE="$RUN_DIR/bus.pid"

DASHBOARD_URL="http://127.0.0.1:${MULTIPI_DASHBOARD_PORT:-43872}"
DASHBOARD_BRIDGE_SCRIPT="$REPO_ROOT/multipi/ext/dashboard/scripts/multipi-bridge.mjs"
DASHBOARD_BRIDGE_LOG="$RUN_DIR/dashboard-bridge.log"
DASHBOARD_BRIDGE_PID_FILE="$RUN_DIR/dashboard-bridge.pid"
DASHBOARD_BRIDGE_STATE="$RUN_DIR/dashboard-bridge-state.json"
DASHBOARD_BRIDGE_ACTIVE=0

mkdir -p "$BUS_DATA_DIR"

demo_log "case: $CASE_NAME"
demo_log "run dir: $RUN_DIR"
demo_log "bus: $BUS_URL (isolated, does not touch your default ~/.pi/bus)"

# --- start isolated bus service ---
(
	cd "$SERVICE_DIR"
	PI_BUS_HOST=127.0.0.1 \
		PI_BUS_PORT="$BUS_PORT" \
		PI_BUS_DATA_DIR="$BUS_DATA_DIR" \
		PI_BUS_DB="$BUS_DB" \
		PI_BUS_PID="$RUN_DIR/bus-internal.pid" \
		nohup node server.js >"$BUS_LOG" 2>&1 &
	echo $! >"$BUS_PID_FILE"
)

BUS_SERVICE_PID="$(read_pid_file "$BUS_PID_FILE")"
demo_log "bus service pid: $BUS_SERVICE_PID"

cleanup() {
	if [ "$KEEP_RUNNING" = "1" ]; then
		return
	fi
	demo_log "stopping agents and bus service..."
	for pid_file in "$RUN_DIR"/agent-*.pid; do
		[ -f "$pid_file" ] || continue
		"$COMMON_DIR/stop_agent.sh" "$(cat "$pid_file")" 8
	done
	if [ "$DASHBOARD_BRIDGE_ACTIVE" = "1" ]; then
		stop_pid "$(read_pid_file "$DASHBOARD_BRIDGE_PID_FILE")" 3
	fi
	stop_pid "$BUS_SERVICE_PID" 5
}
trap cleanup EXIT

if ! wait_for_bus_health "$BUS_URL" 15; then
	demo_err "bus service did not become healthy in time; see $BUS_LOG"
	exit 1
fi
demo_log "bus service is healthy"

# --- optionally mirror this run into the multipi dashboard, tagged as demo ---
if [ "$ENABLE_DASHBOARD_BRIDGE" = "1" ]; then
	if dashboard_is_running "$DASHBOARD_URL"; then
		if [ -f "$DASHBOARD_BRIDGE_SCRIPT" ]; then
			demo_log "dashboard detected at $DASHBOARD_URL; mirroring this run as a tagged 'demo' chat"
			(
				PI_BUS_URL="$BUS_URL" \
					MULTIPI_DASHBOARD_URL="$DASHBOARD_URL" \
					MULTIPI_BRIDGE_STATE_PATH="$DASHBOARD_BRIDGE_STATE" \
					MULTIPI_BRIDGE_EXTRA_TAG="demo" \
					MULTIPI_BRIDGE_TITLE_PREFIX="[demo] " \
					nohup node "$DASHBOARD_BRIDGE_SCRIPT" >"$DASHBOARD_BRIDGE_LOG" 2>&1 &
				echo $! >"$DASHBOARD_BRIDGE_PID_FILE"
			)
			DASHBOARD_BRIDGE_ACTIVE=1
		else
			demo_log "dashboard bridge script not found (dashboard submodule not checked out); skipping mirroring"
		fi
	else
		demo_log "no dashboard detected at $DASHBOARD_URL; skipping mirroring (run 'bus dashboard' first to see this run there)"
	fi
fi

# --- spawn agents ---
i=0
while [ "$i" -lt "${#CASE_AGENTS[@]}" ]; do
	agent="${CASE_AGENTS[$i]}"
	prompt_file="$CASE_DIR/prompts/${CASE_PROMPT_FILES[$i]}"
	if [ ! -f "$prompt_file" ]; then
		demo_err "missing prompt file: $prompt_file"
		exit 1
	fi

	agent_work_dir="$RUN_DIR/agents/$agent"
	agent_log="$RUN_DIR/agent-$agent.log"
	agent_pid_file="$RUN_DIR/agent-$agent.pid"

	demo_log "spawning $agent ..."
	"$COMMON_DIR/spawn_agent.sh" \
		"$agent_work_dir" "$prompt_file" "$agent_log" "$agent_pid_file" \
		"$EXTENSION_ENTRY" "$BUS_URL" \
		"PI_BUS_WAKEUP_METRICS_LOG=$METRICS_LOG" \
		>/dev/null

	i=$((i + 1))
done

demo_log "waiting for all agents to register online (timeout ${CASE_STARTUP_TIMEOUT_SECONDS}s)..."
if ! wait_for_agents_online "$BUS_URL" "$CASE_STARTUP_TIMEOUT_SECONDS" "${CASE_AGENTS[@]}"; then
	demo_err "not all agents came online in time; see $RUN_DIR/agent-*.log"
	exit 1
fi
demo_log "all agents online: ${CASE_AGENTS[*]}"

if [ "$KEEP_RUNNING" = "1" ]; then
	demo_log "running with --keep-running; case will keep going in the background."
	demo_log "bus URL:      $BUS_URL"
	demo_log "run dir:      $RUN_DIR"
	demo_log "watch history: PI_BUS_URL=$BUS_URL PI_BUS_DATA_DIR=$BUS_DATA_DIR bus history --oneline"
	demo_log "stop agents:   for f in $RUN_DIR/agent-*.pid; do $COMMON_DIR/stop_agent.sh \"\$(cat \$f)\"; done"
	demo_log "stop bus:      kill $BUS_SERVICE_PID"
	if [ "$DASHBOARD_BRIDGE_ACTIVE" = "1" ]; then
		demo_log "stop bridge:   kill $(read_pid_file "$DASHBOARD_BRIDGE_PID_FILE")"
		demo_log "look for a chat tagged 'demo' in the dashboard (title starts with '[demo] ')"
	fi
	trap - EXIT
	exit 0
fi

demo_log "letting the case run for ${CASE_DURATION_SECONDS}s..."
sleep "$CASE_DURATION_SECONDS"

demo_log "stopping agents gracefully (so wakeup-metrics.jsonl gets flushed)..."
for pid_file in "$RUN_DIR"/agent-*.pid; do
	[ -f "$pid_file" ] || continue
	"$COMMON_DIR/stop_agent.sh" "$(cat "$pid_file")" 8
done
trap - EXIT
if [ "$DASHBOARD_BRIDGE_ACTIVE" = "1" ]; then
	stop_pid "$(read_pid_file "$DASHBOARD_BRIDGE_PID_FILE")" 3
fi
stop_pid "$BUS_SERVICE_PID" 5

demo_log "analyzing run..."
AGENTS_CSV="$(
	IFS=,
	echo "${CASE_AGENTS[*]}"
)"
REPORT_JSON="$RUN_DIR/report.json"
SUMMARY_TXT="$RUN_DIR/summary.txt"
NODE_PATH="$SERVICE_DIR/node_modules" node "$COMMON_DIR/analyze_run.cjs" \
	--db "$BUS_DB" \
	--metrics "$METRICS_LOG" \
	--agents "$AGENTS_CSV" \
	--out "$REPORT_JSON" \
	>/dev/null 2>"$SUMMARY_TXT" || true

cat "$SUMMARY_TXT" >&2
demo_log "report written to: $REPORT_JSON"
demo_log "summary written to: $SUMMARY_TXT"
demo_log "full run artifacts: $RUN_DIR"
if [ "$DASHBOARD_BRIDGE_ACTIVE" = "1" ]; then
	demo_log "this run's messages were mirrored into the dashboard as a chat tagged 'demo' (stays there after this run ends)"
fi
