import { Type, type Static } from "typebox";
import type { AgentState } from "./agents";
import type { BusClient } from "./client";
import { BusMessagePayloadSchema, validatePayload } from "./protocol";
import type { BusStats, BusStatusUI } from "./stats";

export const SendToBusParams = Type.Object({
	dest_agent_names: Type.Array(Type.String(), {
		description: "Destination agent names. Use get_all_agents to discover valid names.",
	}),
	message: BusMessagePayloadSchema,
});

export type SendToBusInput = Static<typeof SendToBusParams>;

export function createSendToBusTool(client: BusClient, state: AgentState, stats: BusStats) {
	return {
		name: "send_to_bus",
		label: "Send to Bus",
		description: "Send a protocol message to one or more named agents.",
		promptSnippet: "Send a task, question, or reply message to specific online agents.",
		promptGuidelines: [
			"Use send_to_bus when the user asks you to coordinate with another agent.",
			"The message must contain subject, content, and attachment. attachment must always be a file path list, even when empty.",
			"Use attachment for file paths that are inconvenient to inline in content.",
		],
		parameters: SendToBusParams,
		async execute(_toolCallId: string, params: SendToBusInput, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: { ui?: BusStatusUI }) {
			const self = state.require();
			validatePayload(params.message);
			const result = await client.sendMessage(self.name, params.dest_agent_names, params.message);
			stats.addSent(result.inserted);
			stats.update(ctx?.ui);
			return {
				content: [{ type: "text" as const, text: `Sent ${result.inserted} message(s) from '${self.name}'.` }],
				details: result,
			};
		},
	};
}
