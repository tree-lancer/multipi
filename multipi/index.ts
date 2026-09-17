import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentState } from "./core/agents";
import { createGetAllAgentsTool, createRegisterSelfTool, createWhoAmITool } from "./tools/agent-tools";
import { BusClient } from "./core/client";
import { createRecvFromBusTool } from "./tools/recv";
import { createSendToBusTool } from "./tools/send";
import { BusStats } from "./core/stats";
import { createWaitBusTool } from "./tools/wait";
import { TaskClient } from "./ext/task-dispatch/client";
import { registerMultipiTasksCommand } from "./ext/task-dispatch/command";
import { createTaskTools } from "./ext/task-dispatch/tools";

const baseDir = dirname(fileURLToPath(import.meta.url));

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
 * - publish_task(background, assignments, timeout_minutes?)
 * - get_task()
 * - complete_task(result?)
 * - kill_task(task_id)
 *
 * Command: /multipi-tasks — active task overview panel
 */

export default function piBusExtension(pi: ExtensionAPI) {
	const client = new BusClient();
	const state = new AgentState();
	const stats = new BusStats();
	const waitBus = createWaitBusTool(pi, client, state, stats);
	const taskClient = new TaskClient(client);
	const taskTools = createTaskTools(taskClient, state);

	pi.on("resources_discover", () => ({
		skillPaths: [join(baseDir, "skills")],
	}));

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
	pi.registerTool(taskTools.publishTask);
	pi.registerTool(taskTools.getTask);
	pi.registerTool(taskTools.completeTask);
	pi.registerTool(taskTools.killTask);
	registerMultipiTasksCommand(pi, taskClient);
}
