import { Type } from "typebox";
import type { BusClient } from "../core/client";
import type { BusStats, BusStatusUI } from "../core/stats";
import {
	AgentState,
	GetAllAgentsParams,
	type GetAllAgentsInput,
	RegisterSelfParams,
	type RegisterSelfInput,
} from "../core/agents";

export function createRegisterSelfTool(client: BusClient, state: AgentState, stats: BusStats) {
	return {
		name: "register_self",
		label: "Register Self",
		description: "Register this pi process as an online agent with a unique name and description.",
		promptSnippet: "Register this pi process as a discoverable multi-agent bus participant.",
		promptGuidelines: [
			"Call register_self before using send_to_bus, wait_bus, or recv_from_bus.",
			"Choose a stable and unique name that other agents can recognize.",
		],
		parameters: RegisterSelfParams,
		async execute(_toolCallId: string, params: RegisterSelfInput, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: { ui?: BusStatusUI }) {
			const identity = { name: params.name.trim(), description: params.description.trim() };
			if (!identity.name) throw new Error("Agent name cannot be empty.");
			state.set(identity);
			const record = await client.registerAgent(identity, state.getSessionId());
			if (state.getSessionId()) await client.bindSession(state.getSessionId()!, identity.name);
			stats.update(ctx?.ui);
			return {
				content: [{ type: "text" as const, text: `Registered agent '${record.name}'.` }],
				details: record,
			};
		},
	};
}

export function createWhoAmITool(state: AgentState) {
	return {
		name: "who_am_i",
		label: "Who Am I",
		description: "Show the current agent identity registered in this pi process.",
		promptSnippet: "Inspect this process's current bus identity.",
		promptGuidelines: ["Use who_am_i when you need to know this agent's registered name and description."],
		parameters: Type.Object({}),
		async execute() {
			const identity = state.get();
			return {
				content: [
					{
						type: "text" as const,
						text: identity
							? JSON.stringify(identity, null, 2)
							: "This pi process is not registered as an agent. Call register_self first.",
					},
				],
				details: { identity },
			};
		},
	};
}

export function createGetAllAgentsTool(client: BusClient, state: AgentState) {
	return {
		name: "get_all_agents",
		label: "Get All Agents",
		description: "List other registered agents, optionally including descriptions and online status.",
		promptSnippet: "Discover other agents available on the multi-agent bus.",
		promptGuidelines: [
			"Use get_all_agents before choosing destinations for send_to_bus.",
			"Do not send to unknown agent names unless the user explicitly supplied them.",
		],
		parameters: GetAllAgentsParams,
		async execute(_toolCallId: string, params: GetAllAgentsInput) {
			const self = state.get();
			const agents = await client.getAgents(self?.name);
			const withDescription = params.with_description ?? true;
			const withOnlineStatus = params.with_online_status ?? true;
			const view = agents.map((agent) => ({
				name: agent.name,
				...(withDescription ? { description: agent.description } : {}),
				...(withOnlineStatus ? { online: agent.online, lastSeenAt: agent.lastSeenAt } : {}),
			}));
			return {
				content: [{ type: "text" as const, text: JSON.stringify(view, null, 2) }],
				details: { agents: view },
			};
		},
	};
}
