import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { AgentIdentity, AgentState } from "../core/agents";
import type { BusClient, BusMessageEvent } from "../core/client";
import type { BusStats, BusStatusUI } from "../core/stats";

export const WaitBusParams = Type.Object({});

export type WaitBusInput = Static<typeof WaitBusParams>;

export function createWaitBusTool(pi: ExtensionAPI, client: BusClient, state: AgentState, stats: BusStats) {
	let controller: AbortController | undefined;
	let runningFor: string | undefined;
	let active = true;

	const stop = () => {
		active = false;
		controller?.abort();
		controller = undefined;
		runningFor = undefined;
	};

	const tool = {
		name: "wait_bus",
		label: "Wait Bus",
		description: "Start a background event listener for this registered agent and trigger an agent turn when messages arrive.",
		promptSnippet: "Put this agent online and watch for incoming bus messages in the background.",
		promptGuidelines: [
			"Use wait_bus after register_self when this agent should be available for coordination.",
			"wait_bus starts a background event subscription and returns immediately; use recv_from_bus to consume messages.",
		],
		parameters: WaitBusParams,
		async execute(_toolCallId: string, _params: WaitBusInput, _signal?: AbortSignal, _onUpdate?: unknown, ctx?: { ui?: BusStatusUI }) {
			const self = state.require();

			if (controller && runningFor === self.name) {
				return {
					content: [{ type: "text" as const, text: `Background bus listener is already running for '${self.name}'.` }],
					details: { running: true, agent: self.name, mode: "event-stream" },
				};
			}

			controller?.abort();
			controller = new AbortController();
			runningFor = self.name;
			active = true;
			stats.update(ctx?.ui);
			void backgroundEventLoop(pi, client, state, self, controller.signal, () => active);

			return {
				content: [{ type: "text" as const, text: `Background bus event listener started for '${self.name}'.` }],
				details: { running: true, agent: self.name, mode: "event-stream" },
			};
		},
	};

	return { tool, stop };
}

async function backgroundEventLoop(
	pi: ExtensionAPI,
	client: BusClient,
	state: AgentState,
	identity: AgentIdentity,
	signal: AbortSignal,
	isActive: () => boolean,
): Promise<void> {
	while (!signal.aborted && isActive()) {
		try {
			await client.registerAgent(identity, state.getSessionId());
			await client.subscribeMessages(
				identity.name,
				(event) => handleBusEvent(pi, state, identity, event, isActive),
				signal,
			);
			if (!signal.aborted && isActive()) await sleep(1000, signal).catch(() => undefined);
		} catch (_error) {
			if (signal.aborted || !isActive()) return;
			await sleep(3000, signal).catch(() => undefined);
		}
	}
}

function handleBusEvent(
	pi: ExtensionAPI,
	state: AgentState,
	identity: AgentIdentity,
	event: BusMessageEvent,
	isActive: () => boolean,
): void {
	if (!isActive() || state.get()?.name !== identity.name || event.type !== "pending" || event.count <= 0) return;

	const prompt = `[bus] ${event.count} message(s) pending for '${identity.name}'`;

	try {
		pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	} catch {
		// The extension runtime may have been replaced or reloaded between the
		// event callback and sendUserMessage. Session shutdown aborts the loop;
		// this catch prevents a late callback from crashing pi.
	}
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
