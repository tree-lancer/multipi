#!/usr/bin/env bash
# Shared helpers for demo/run_case.sh. Sourced, not executed directly.
# Bash 3.2 compatible (macOS default /bin/bash) — no associative arrays, no mapfile.

demo_log() {
	printf '[demo] %s\n' "$*" >&2
}

demo_err() {
	printf '[demo] ERROR: %s\n' "$*" >&2
}

demo_require_cmd() {
	local cmd="$1"
	if ! command -v "$cmd" >/dev/null 2>&1; then
		demo_err "required command not found: $cmd"
		return 1
	fi
}

# Poll a bus service's /health endpoint until it responds ok, or time out.
# Usage: wait_for_bus_health <base-url> <timeout-seconds>
wait_for_bus_health() {
	local url="$1" timeout="$2" waited=0
	while [ "$waited" -lt "$timeout" ]; do
		if curl -fsS "$url/health" >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
		waited=$((waited + 1))
	done
	return 1
}

# Poll a bus service's /agents endpoint until every given agent name is
# online, or time out. Agent names are passed as remaining args.
# Usage: wait_for_agents_online <base-url> <timeout-seconds> <agent1> [agent2 ...]
wait_for_agents_online() {
	local url="$1" timeout="$2"
	shift 2
	local agents=("$@")
	local waited=0
	while [ "$waited" -lt "$timeout" ]; do
		local body all_online
		body="$(curl -fsS "$url/agents" 2>/dev/null || echo '[]')"
		all_online=1
		local name
		for name in "${agents[@]}"; do
			if ! printf '%s' "$body" | grep -q "\"name\":\"$name\".*\"online\":true"; then
				all_online=0
				break
			fi
		done
		if [ "$all_online" = "1" ]; then
			return 0
		fi
		sleep 1
		waited=$((waited + 1))
	done
	return 1
}

# Count bus messages currently addressed to any of the given agents, via the
# sqlite file directly (no server dependency). Requires node + better-sqlite3
# (reuses multipi/service/node_modules).
# Usage: count_case_messages <sqlite-path> <service-node-modules-dir> <agent1> [agent2 ...]
count_case_messages() {
	local db="$1" node_modules_dir="$2"
	shift 2
	local agents_csv
	agents_csv="$(printf '%s,' "$@")"
	NODE_PATH="$node_modules_dir" node -e "
		const Database = require('better-sqlite3');
		const db = new Database(process.argv[1]);
		const agents = process.argv[2].split(',').filter(Boolean);
		const placeholders = agents.map(() => '?').join(',');
		const row = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE dest IN (' + placeholders + ')').get(...agents);
		console.log(row.n);
	" "$db" "$agents_csv" 2>/dev/null || echo 0
}

# Kill a pid if it is still alive, escalating from SIGTERM to SIGKILL.
# Usage: stop_pid <pid> <grace-seconds>
stop_pid() {
	local pid="$1" grace="${2:-5}"
	if [ -z "$pid" ] || ! kill -0 "$pid" >/dev/null 2>&1; then
		return 0
	fi
	kill -TERM "$pid" >/dev/null 2>&1 || true
	local waited=0
	while [ "$waited" -lt "$grace" ] && kill -0 "$pid" >/dev/null 2>&1; do
		sleep 1
		waited=$((waited + 1))
	done
	if kill -0 "$pid" >/dev/null 2>&1; then
		kill -KILL "$pid" >/dev/null 2>&1 || true
	fi
}

# Check whether the multipi dashboard is currently reachable.
# Usage: dashboard_is_running <dashboard-url>
dashboard_is_running() {
	local url="$1"
	curl -fsS "$url/api/v1/health" >/dev/null 2>&1
}

# Read a pid from a file if it exists and is non-empty.
read_pid_file() {
	local file="$1"
	if [ -f "$file" ]; then
		cat "$file" 2>/dev/null
	fi
}
