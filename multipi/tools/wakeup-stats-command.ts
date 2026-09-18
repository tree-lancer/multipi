import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { WakeupMetrics } from "../core/wakeup";

export function registerWakeupStatsCommand(pi: ExtensionAPI, wakeupMetrics: WakeupMetrics) {
	pi.registerCommand("multipi-wakeup-stats", {
		description: "Show this session's wakeup policy metrics (wakeups, idle wakeups, skipped duplicates)",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			const snapshot = wakeupMetrics.snapshot();
			ctx.ui.notify(
				`wakeups=${snapshot.wakeups} idle=${snapshot.idleWakeups} skippedDuplicate=${snapshot.skippedDuplicate} sendersNotified=${snapshot.sendersNotified}`,
				"info",
			);
		},
	});
}
