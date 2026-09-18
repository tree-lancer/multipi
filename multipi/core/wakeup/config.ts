import type { WakeupPolicyConfig } from "./types";

const DEFAULT_DEBOUNCE_MS = 150;

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Resolve the wakeup policy configuration from environment variables, with
 * safe defaults. Kept isolated from wait.ts/server.js so evaluation runs can
 * sweep these values by setting env vars per-process, without code changes.
 */
export function resolveWakeupPolicyConfig(): WakeupPolicyConfig {
	return {
		debounceMs: envInt("PI_BUS_WAKEUP_DEBOUNCE_MS", DEFAULT_DEBOUNCE_MS),
	};
}
