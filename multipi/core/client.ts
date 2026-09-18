import type { AgentIdentity, AgentRecord } from "./agents";
import type { BusDeliveredMessage, BusMessagePayload } from "./protocol";
import type { PendingBatch } from "./wakeup";

export type BusClientOptions = {
	baseUrl?: string;
};

export type BusMessageEvent = { type: "pending" } & PendingBatch;

export class BusClient {
	readonly baseUrl: string;

	constructor(options: BusClientOptions = {}) {
		this.baseUrl = (options.baseUrl ?? process.env.PI_BUS_URL ?? "http://127.0.0.1:43871").replace(/\/$/, "");
	}

	async registerAgent(identity: AgentIdentity, sessionId?: string): Promise<AgentRecord> {
		return this.request<AgentRecord>("/agents/register", {
			method: "POST",
			body: JSON.stringify({ ...identity, sessionId }),
		});
	}

	async getSessionIdentity(sessionId: string): Promise<AgentIdentity | undefined> {
		const result = await this.request<{ identity?: AgentIdentity }>(
			`/sessions/identity?sessionId=${encodeURIComponent(sessionId)}`,
		);
		return result.identity;
	}

	async bindSession(sessionId: string, agentName: string): Promise<void> {
		await this.request<{ ok: true }>("/sessions/bind", {
			method: "POST",
			body: JSON.stringify({ sessionId, agentName }),
		});
	}

	async getAgents(exclude?: string): Promise<AgentRecord[]> {
		const query = exclude ? `?exclude=${encodeURIComponent(exclude)}` : "";
		return this.request<AgentRecord[]>(`/agents${query}`);
	}

	async sendMessage(from: string, to: string[], message: BusMessagePayload): Promise<{ inserted: number; ids: number[] }> {
		return this.request<{ inserted: number; ids: number[] }>("/messages/send", {
			method: "POST",
			body: JSON.stringify({ from, to, message }),
		});
	}

	async recvMessages(agent: string, limit: number, from?: string): Promise<BusDeliveredMessage[]> {
		return this.request<BusDeliveredMessage[]>("/messages/recv", {
			method: "POST",
			body: JSON.stringify({ agent, limit, from }),
		});
	}

	async waitMessages(agent: string, timeoutMs: number, signal?: AbortSignal): Promise<{ available: boolean; count: number }> {
		return this.request<{ available: boolean; count: number }>("/messages/wait", {
			method: "POST",
			body: JSON.stringify({ agent, timeoutMs }),
			signal,
		});
	}

	async subscribeMessages(
		agent: string,
		onEvent: (event: BusMessageEvent) => void,
		signal?: AbortSignal,
	): Promise<void> {
		const response = await fetch(`${this.baseUrl}/messages/events?agent=${encodeURIComponent(agent)}`, {
			headers: { accept: "text/event-stream" },
			signal,
		});
		if (!response.ok || !response.body) {
			throw new Error(`Bus event subscription failed: HTTP ${response.status}`);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (!signal?.aborted) {
				const { value, done } = await reader.read();
				if (done) return;
				buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

				let boundary = buffer.indexOf("\n\n");
				while (boundary !== -1) {
					const raw = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const data = raw
						.split("\n")
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trimStart())
						.join("\n");
					if (data) {
						try {
							onEvent(JSON.parse(data) as BusMessageEvent);
						} catch {
							// Ignore malformed SSE records so one bad event does not kill
							// the background subscription.
						}
					}
					boundary = buffer.indexOf("\n\n");
				}
			}
		} finally {
			try {
				if (signal?.aborted) await reader.cancel();
			} catch {}
			try {
				reader.releaseLock();
			} catch {}
		}
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			...init,
			headers: {
				"content-type": "application/json",
				...(init.headers ?? {}),
			},
		});

		const text = await response.text();
		const data = text ? JSON.parse(text) : undefined;
		if (!response.ok) {
			throw new Error(data?.error ?? `Bus service request failed: HTTP ${response.status}`);
		}
		return data as T;
	}
}
