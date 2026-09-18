import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { WakeupMetricsSnapshot } from "./metrics";

function defaultLogPath(): string {
	return process.env.PI_BUS_WAKEUP_METRICS_LOG ?? join(homedir(), ".pi", "bus", "wakeup-metrics.jsonl");
}

export type WakeupMetricsLogEntry = {
	ts: string;
	agent: string;
	sessionId?: string;
} & WakeupMetricsSnapshot;

/**
 * Append one JSONL line with the current metrics snapshot. Called on
 * session_shutdown so each pi process contributes one row per run,
 * independent of any TUI rendering — this is the file an eval harness
 * should read, not the terminal transcript.
 */
export function persistWakeupMetrics(agent: string, sessionId: string | undefined, snapshot: WakeupMetricsSnapshot, logPath = defaultLogPath()): void {
	try {
		mkdirSync(dirname(logPath), { recursive: true });
		const entry: WakeupMetricsLogEntry = { ts: new Date().toISOString(), agent, sessionId, ...snapshot };
		appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
	} catch {
		// Best-effort logging; never fail session shutdown because of it.
	}
}
