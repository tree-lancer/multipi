/**
 * In-memory wakeup metrics for this process. Not persisted — intended to be
 * read via BusStats/UI during a session and, for evaluation runs, dumped at
 * shutdown (see the eval harness). Kept separate from BusStats (core/stats.ts)
 * because these counters are about *decisions*, not raw message counts.
 */
export type WakeupMetricsSnapshot = {
	/** Times decide() returned "notify" (a turn was actually triggered). */
	wakeups: number;
	/** Times decide() returned "skip" because maxId did not advance (e.g. SSE reconnect replay). */
	skippedDuplicate: number;
	/**
	 * Wakeups later found to be idle: the agent called recv_from_bus (with or
	 * without a `from` filter) after being woken and got zero items back.
	 * Recorded by the caller, not by decide() — decide() cannot know whether
	 * a wakeup will turn out to be idle.
	 */
	idleWakeups: number;
	/** Number of distinct senders seen across all notified batches (for grouping-benefit analysis). */
	sendersNotified: number;
};

export class WakeupMetrics {
	private wakeups = 0;
	private skippedDuplicate = 0;
	private idleWakeups = 0;
	private sendersNotified = 0;

	/**
	 * Agents with a notify that has not yet been followed by a recv_from_bus
	 * call. Only the first recv_from_bus after a notify determines whether
	 * that wakeup was idle; subsequent voluntary recv_from_bus calls (an
	 * agent double-checking on its own) do not count either way.
	 */
	private readonly awaitingConfirmation = new Set<string>();

	recordNotify(agent: string, senderCount: number): void {
		this.wakeups += 1;
		this.sendersNotified += Math.max(0, senderCount);
		this.awaitingConfirmation.add(agent);
	}

	recordSkippedDuplicate(): void {
		this.skippedDuplicate += 1;
	}

	recordIdleWakeup(): void {
		this.idleWakeups += 1;
	}

	/**
	 * Call once per recv_from_bus execution, with the number of items it
	 * returned. If this agent had a pending notify awaiting confirmation,
	 * this call resolves it: zero items means the wakeup was idle, any
	 * other count means it was productive. Either way the agent is no
	 * longer "awaiting confirmation" until the next notify.
	 */
	confirmRecv(agent: string, itemCount: number): void {
		if (!this.awaitingConfirmation.delete(agent)) return;
		if (itemCount === 0) this.recordIdleWakeup();
	}

	snapshot(): WakeupMetricsSnapshot {
		return {
			wakeups: this.wakeups,
			skippedDuplicate: this.skippedDuplicate,
			idleWakeups: this.idleWakeups,
			sendersNotified: this.sendersNotified,
		};
	}

	reset(): void {
		this.wakeups = 0;
		this.skippedDuplicate = 0;
		this.idleWakeups = 0;
		this.sendersNotified = 0;
		this.awaitingConfirmation.clear();
	}
}
