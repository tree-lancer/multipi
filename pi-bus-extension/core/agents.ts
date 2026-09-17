import { Type, type Static } from "typebox";

export const RegisterSelfParams = Type.Object({
	name: Type.String({
		description: "Unique agent name. Other agents will use this name as a message destination.",
	}),
	description: Type.String({
		description: "Short English description of this agent's role, capabilities, and current responsibility.",
	}),
});

export type RegisterSelfInput = Static<typeof RegisterSelfParams>;

export const GetAllAgentsParams = Type.Object({
	with_description: Type.Optional(
		Type.Boolean({ description: "Include agent descriptions. Defaults to true." }),
	),
	with_online_status: Type.Optional(
		Type.Boolean({ description: "Include online status. Defaults to true." }),
	),
});

export type GetAllAgentsInput = Static<typeof GetAllAgentsParams>;

export type AgentIdentity = {
	name: string;
	description: string;
};

export type AgentRecord = AgentIdentity & {
	online?: boolean;
	lastSeenAt?: string;
};

export class AgentState {
	private identity?: AgentIdentity;
	private sessionId?: string;

	setSessionId(sessionId: string | undefined): void {
		this.sessionId = sessionId;
	}

	getSessionId(): string | undefined {
		return this.sessionId;
	}

	set(identity: AgentIdentity): void {
		this.identity = identity;
	}

	clear(): void {
		this.identity = undefined;
	}

	get(): AgentIdentity | undefined {
		return this.identity;
	}

	require(): AgentIdentity {
		if (!this.identity) {
			throw new Error("Agent identity is not registered. Call register_self first.");
		}
		return this.identity;
	}
}
