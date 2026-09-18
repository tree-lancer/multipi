import type { PendingBatch, WakeupDecision, WakeupPolicyConfig } from "./types";

/**
 * Pure decision function: given the current pending state for an agent and
 * the maxId this policy already notified about, decide whether to trigger a
 * turn and what to say.
 *
 * No I/O, no clock, no randomness — this is the unit the eval harness (and
 * later, RSI itself) can score in isolation, by feeding recorded
 * PendingBatch sequences and comparing decisions against a baseline.
 *
 * Idempotency: because there is no way to recall an already-delivered
 * sendUserMessage (pi's ExtensionAPI does not expose queue cancellation —
 * only the internal AgentSession.clearQueue(), which extensions cannot
 * reach), the only correctness lever available is to never notify twice for
 * the same frontier. That frontier is `maxId`: once we have notified up to
 * some id, any batch that does not advance past it is a duplicate signal
 * (e.g. an SSE reconnect replaying the same unread backlog) and must be
 * skipped.
 */
export function decide(
	batch: PendingBatch,
	lastNotifiedMaxId: number,
	_config: WakeupPolicyConfig,
): WakeupDecision {
	if (batch.totalCount <= 0 || batch.maxId <= 0) {
		return { action: "skip", reason: "empty" };
	}
	if (batch.maxId <= lastNotifiedMaxId) {
		return { action: "skip", reason: "no-advance" };
	}
	return {
		action: "notify",
		text: formatWakeupPrompt(batch),
		notifiedMaxId: batch.maxId,
	};
}

/**
 * Render the pending batch as a wakeup prompt. Only routing metadata
 * (sender, count, subject breakdown) is included — never message content —
 * so this can never leak a message the destination agent has not actually
 * fetched via recv_from_bus, and never gets stale relative to the message
 * body.
 */
export function formatWakeupPrompt(batch: PendingBatch): string {
	const lines = [`[bus] ${batch.totalCount} message(s) pending for '${batch.agent}'`];
	for (const entry of batch.bySender) {
		const subjectParts = Object.entries(entry.subjects)
			.filter(([, count]) => (count ?? 0) > 0)
			.map(([subject, count]) => `${subject}×${count}`)
			.join(", ");
		lines.push(`  from ${entry.sender}: ${entry.count}${subjectParts ? ` (${subjectParts})` : ""}`);
	}
	return lines.join("\n");
}

/**
 * Stateful wrapper around decide(): tracks the last notified frontier per
 * agent so callers (wait.ts) do not need to manage that bookkeeping
 * themselves. State is in-memory and per-process; losing it on restart only
 * risks one extra duplicate notification, never a missed one, since
 * decide() is conservative (unknown frontier == 0 == "always advances").
 */
export class WakeupPolicy {
	private readonly config: WakeupPolicyConfig;
	private readonly notifiedMaxIdByAgent = new Map<string, number>();

	constructor(config: WakeupPolicyConfig) {
		this.config = config;
	}

	decide(batch: PendingBatch): WakeupDecision {
		const lastNotifiedMaxId = this.notifiedMaxIdByAgent.get(batch.agent) ?? 0;
		const decision = decide(batch, lastNotifiedMaxId, this.config);
		if (decision.action === "notify") {
			this.notifiedMaxIdByAgent.set(batch.agent, decision.notifiedMaxId);
		}
		return decision;
	}

	/** Reset tracked frontier for an agent (e.g. on register_self rebind). */
	reset(agent: string): void {
		this.notifiedMaxIdByAgent.delete(agent);
	}
}
