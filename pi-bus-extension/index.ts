import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentState } from "./agents";
import { createGetAllAgentsTool, createRegisterSelfTool, createWhoAmITool } from "./agent-tools";
import { BusClient } from "./client";
import { createRecvFromBusTool } from "./recv";
import { createSendToBusTool } from "./send";
import { BusStats } from "./stats";
import { createWaitBusTool } from "./wait";

/**
 * Pi Multi-Agent Bus Extension
 *
 * Tools:
 * - register_self(name, description)
 * - who_am_i()
 * - get_all_agents(with_description, with_online_status)
 * - send_to_bus(dest_agent_names, message)
 * - wait_bus()
 * - recv_from_bus()
 */

export default function piBusExtension(pi: ExtensionAPI) {
	const client = new BusClient();
	const state = new AgentState();
	const stats = new BusStats();
	const waitBus = createWaitBusTool(pi, client, state, stats);

	pi.on("session_start", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		state.setSessionId(sessionId);
		stats.update(ctx.ui);

		if (sessionId) {
			try {
				const identity = await client.getSessionIdentity(sessionId);
				if (identity) {
					state.set(identity);
					await client.registerAgent(identity, sessionId);
				}
			} catch {
				// Bus service may be down at startup. Tools will report connection
				// errors when used; do not fail extension loading.
			}
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		waitBus.stop();
		stats.clear(ctx.ui);
	});

	pi.registerTool(createRegisterSelfTool(client, state, stats));
	pi.registerTool(createWhoAmITool(state));
	pi.registerTool(createGetAllAgentsTool(client, state));
	pi.registerTool(createSendToBusTool(client, state, stats));
	pi.registerTool(waitBus.tool);
	pi.registerTool(createRecvFromBusTool(client, state, stats));
}
