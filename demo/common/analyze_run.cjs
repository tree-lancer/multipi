#!/usr/bin/env node
// Produce a wakeup-policy evaluation report for one demo case run.
//
// Reads two independent sources of truth, deliberately avoiding any
// terminal transcript scraping (TUI repaint noise makes line-counting from
// captured output unreliable — see demo/README.md "Why not parse terminal
// output"):
//
//   1. The bus sqlite `messages` table — ground truth for what was actually
//      sent/delivered, with real timestamps. Used for message counts and an
//      offline debounce replay (see replayDebounce below) that estimates
//      how many notify events a given debounceMs window would have
//      collapsed, purely from message arrival times.
//   2. wakeup-metrics.jsonl (see multipi/core/wakeup/persist.ts) — the
//      actual runtime decisions made by WakeupPolicy/WakeupMetrics inside
//      each pi process: real wakeups, real idle wakeups, real skipped
//      duplicates. This is the only reliable source for "how many times did
//      a wakeup lead to zero messages".
//
// Usage:
//   analyze_run.cjs --db <sqlite-path> --metrics <jsonl-path> \
//     --agents a,b,c [--debounce-ms 150] [--out <report.json>]

const Database = require("better-sqlite3");
const { readFileSync, existsSync, writeFileSync } = require("node:fs");

function parseArgs(argv) {
	const out = { debounceMs: 150 };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--db") out.db = argv[++i];
		else if (arg === "--metrics") out.metrics = argv[++i];
		else if (arg === "--agents") out.agents = argv[++i].split(",").filter(Boolean);
		else if (arg === "--debounce-ms") out.debounceMs = Number(argv[++i]);
		else if (arg === "--out") out.out = argv[++i];
	}
	if (!out.db || !out.agents || out.agents.length === 0) {
		throw new Error("usage: analyze_run.cjs --db <sqlite-path> --agents a,b,c [--metrics <jsonl-path>] [--debounce-ms 150] [--out <report.json>]");
	}
	return out;
}

function loadMessages(dbPath, agents) {
	const db = new Database(dbPath, { readonly: true });
	const placeholders = agents.map(() => "?").join(",");
	const rows = db
		.prepare(`SELECT id, sender, dest, subject, created_at FROM messages WHERE dest IN (${placeholders}) ORDER BY id`)
		.all(...agents);
	db.close();
	return rows;
}

// Estimate how many notify events a debounce window of debounceMs would
// produce for one destination agent, given only message arrival times. This
// mirrors the collapsing behaviour of WakeupPolicy's debounce timer in
// wait.ts: consecutive arrivals within debounceMs of the window start merge
// into a single notify.
function replayDebounce(messages, debounceMs) {
	const sorted = [...messages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
	let notifies = 0;
	let i = 0;
	while (i < sorted.length) {
		notifies++;
		const windowStart = new Date(sorted[i].created_at).getTime();
		let j = i + 1;
		while (j < sorted.length && new Date(sorted[j].created_at).getTime() - windowStart <= debounceMs) j++;
		i = j;
	}
	return notifies;
}

function loadMetrics(metricsPath, agents) {
	if (!metricsPath || !existsSync(metricsPath)) return [];
	const lines = readFileSync(metricsPath, "utf8").split("\n").filter(Boolean);
	const agentSet = new Set(agents);
	const entries = [];
	for (const line of lines) {
		try {
			const entry = JSON.parse(line);
			if (agentSet.has(entry.agent)) entries.push(entry);
		} catch {
			// Ignore malformed lines rather than failing the whole report.
		}
	}
	return entries;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const allMessages = loadMessages(opts.db, opts.agents);
	const metricsEntries = loadMetrics(opts.metrics, opts.agents);

	const perAgent = opts.agents.map((agent) => {
		const messages = allMessages.filter((m) => m.dest === agent);
		const bySubject = {};
		for (const m of messages) bySubject[m.subject] = (bySubject[m.subject] || 0) + 1;

		const naiveWakeups = messages.length;
		const debouncedWakeups = replayDebounce(messages, opts.debounceMs);

		// A process may run multiple times (e.g. reconnects); metrics are
		// per-process snapshots, so sum across all rows for this agent.
		const runtimeMetrics = metricsEntries
			.filter((e) => e.agent === agent)
			.reduce(
				(acc, e) => ({
					wakeups: acc.wakeups + (e.wakeups || 0),
					idleWakeups: acc.idleWakeups + (e.idleWakeups || 0),
					skippedDuplicate: acc.skippedDuplicate + (e.skippedDuplicate || 0),
					sendersNotified: acc.sendersNotified + (e.sendersNotified || 0),
					processRuns: acc.processRuns + 1,
				}),
				{ wakeups: 0, idleWakeups: 0, skippedDuplicate: 0, sendersNotified: 0, processRuns: 0 },
			);

		return {
			agent,
			messages: messages.length,
			bySubject,
			naiveWakeups,
			debouncedWakeups,
			debounceSaved: naiveWakeups - debouncedWakeups,
			runtimeMetrics,
		};
	});

	const totals = perAgent.reduce(
		(acc, a) => ({
			messages: acc.messages + a.messages,
			naiveWakeups: acc.naiveWakeups + a.naiveWakeups,
			debouncedWakeups: acc.debouncedWakeups + a.debouncedWakeups,
			runtimeWakeups: acc.runtimeWakeups + a.runtimeMetrics.wakeups,
			runtimeIdleWakeups: acc.runtimeIdleWakeups + a.runtimeMetrics.idleWakeups,
			runtimeSkippedDuplicate: acc.runtimeSkippedDuplicate + a.runtimeMetrics.skippedDuplicate,
		}),
		{ messages: 0, naiveWakeups: 0, debouncedWakeups: 0, runtimeWakeups: 0, runtimeIdleWakeups: 0, runtimeSkippedDuplicate: 0 },
	);

	const report = {
		generatedAt: new Date().toISOString(),
		debounceMs: opts.debounceMs,
		dbPath: opts.db,
		metricsPath: opts.metrics ?? null,
		metricsAvailable: metricsEntries.length > 0,
		perAgent,
		totals,
	};

	const json = JSON.stringify(report, null, 2);
	if (opts.out) writeFileSync(opts.out, json);
	console.log(json);

	console.error("");
	console.error("=== summary ===");
	for (const a of perAgent) {
		console.error(
			`${a.agent}: messages=${a.messages} naiveWakeups=${a.naiveWakeups} debouncedWakeups=${a.debouncedWakeups} (saved=${a.debounceSaved})` +
				(a.runtimeMetrics.processRuns > 0
					? ` | runtime: wakeups=${a.runtimeMetrics.wakeups} idleWakeups=${a.runtimeMetrics.idleWakeups} skippedDuplicate=${a.runtimeMetrics.skippedDuplicate}`
					: " | runtime: no wakeup-metrics.jsonl entries found for this agent"),
		);
	}
	console.error(
		`total: messages=${totals.messages} naiveWakeups=${totals.naiveWakeups} debouncedWakeups=${totals.debouncedWakeups}` +
			(metricsEntries.length > 0
				? ` | runtime: wakeups=${totals.runtimeWakeups} idleWakeups=${totals.runtimeIdleWakeups} skippedDuplicate=${totals.runtimeSkippedDuplicate}`
				: ""),
	);
}

main();
