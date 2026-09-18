import { Type, type Static } from "typebox";
import type { AgentState } from "../core/agents";
import type { BusClient } from "../core/client";
import type { BusStats, BusStatusUI } from "../core/stats";
import type { WakeupMetrics } from "../core/wakeup";

export const RecvFromBusParams = Type.Object({
	limit: Type.Optional(
		Type.Number({
			description: "Maximum number of messages to receive. Defaults to 10.",
			minimum: 1,
		}),
	),
	from: Type.Optional(
		Type.String({
			description: "Only receive messages from this sender agent name.",
		}),
	),
});

export type RecvFromBusInput = Static<typeof RecvFromBusParams>;

export function createRecvFromBusTool(client: BusClient, state: AgentState, stats: BusStats, wakeupMetrics: WakeupMetrics) {
	return {
		name: "recv_from_bus",
		label: "Receive from Bus",
		description: "Atomically receive queued messages for this registered agent.",
		promptSnippet: "Receive pending messages addressed to this agent.",
		promptGuidelines: [
			"Use recv_from_bus when you need to read messages sent by other agents.",
			"Pass from to only fetch messages from a specific sender, e.g. when a wakeup notice lists multiple senders.",
		],
		parameters: RecvFromBusParams,
		async execute(_toolCallId: string, params: RecvFromBusInput, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: { ui?: BusStatusUI }) {
			const self = state.require();
			const limit = params.limit ?? 10;
			const items = await client.recvMessages(self.name, limit, params.from);
			wakeupMetrics.confirmRecv(self.name, items.length);
			stats.addReceived(items.length);
			stats.update(ctx?.ui);
			return {
				content: [
					{
						type: "text" as const,
						text: items.length === 0
							? `No messages available for '${self.name}'.`
							: JSON.stringify(items, null, 2),
					},
				],
				details: { count: items.length, items },
			};
		},
	};
}
