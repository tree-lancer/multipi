import type { BusMessageSubject } from "../protocol";

/**
 * Per-sender breakdown of a pending batch, as seen from one destination agent.
 * `count` is the number of physical delivery rows from this sender (a
 * multi-destination send inserts one row per destination, so this is a
 * delivery count, not a logical-message count).
 */
export type PendingSenderBreakdown = {
	sender: string;
	count: number;
	subjects: Partial<Record<BusMessageSubject, number>>;
};

/**
 * A snapshot of "what is currently undelivered for this agent", as reported
 * by the bus service. This is the sole input the wakeup policy reasons about;
 * it intentionally excludes message content (no preview, no ack-by-notify).
 */
export type PendingBatch = {
	agent: string;
	/** Highest message id currently undelivered for this agent. */
	maxId: number;
	/** Total undelivered delivery rows for this agent (sum of bySender[].count). */
	totalCount: number;
	bySender: PendingSenderBreakdown[];
};

/**
 * Decision produced by the wakeup policy for a given PendingBatch.
 *
 * - "skip": nothing new since the last notification for this agent
 *   (maxId did not advance); the caller must not trigger a turn.
 * - "notify": trigger a turn with the given prompt text. `notifiedMaxId`
 *   must be persisted by the caller so future batches can be compared
 *   against it (this is how "no duplicate wakeups" is implemented without
 *   any ability to recall an already-sent message).
 */
export type WakeupDecision =
	| { action: "skip"; reason: "no-advance" | "empty" }
	| { action: "notify"; text: string; notifiedMaxId: number };

/**
 * Tunable thresholds for the wakeup policy. All fields have defaults in
 * config.ts and can be overridden via environment variables so the policy
 * can be treated as a parameter set to sweep during evaluation, without
 * touching wait.ts or server.js.
 */
export type WakeupPolicyConfig = {
	/**
	 * Debounce window in milliseconds. Bursts of notifyPending calls within
	 * this window collapse into a single decision. Enforced by the caller
	 * (wait.ts), not by decide() itself, since decide() is a pure function
	 * over a single already-debounced PendingBatch.
	 */
	debounceMs: number;
};
