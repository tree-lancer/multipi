import type { BusClient } from "../../core/client";

export type TaskAssignmentView = { agent_name: string; status: "pending" | "done" };

export type TaskOverviewItem = {
	id: number;
	publisher: string;
	background: string;
	status: string;
	createdAt: string;
	timeoutAt: string | null;
	assignments: TaskAssignmentView[];
};

export type CurrentTask = {
	task: {
		id: number;
		publisher: string;
		background: string;
		status: string;
		createdAt: string;
		timeoutAt: string | null;
	} | null;
	assignment?: { spec: string; status: "pending" | "done" };
};

export type PublishResult = { taskId: number; createdAt: string; timeoutAt: string | null };
export type CompleteResult = { completed: boolean; taskId?: number; taskCompleted?: boolean };

export class TaskClient {
	readonly baseUrl: string;

	constructor(client: BusClient) {
		this.baseUrl = client.baseUrl;
	}

	async publish(publisher: string, background: string, assignments: Record<string, string>, timeoutMinutes: number): Promise<PublishResult> {
		return this.request("/tasks/publish", {
			method: "POST",
			body: JSON.stringify({ publisher, background, assignments, timeoutMinutes }),
		});
	}

	async current(agent: string): Promise<CurrentTask> {
		return this.request(`/tasks/current?agent=${encodeURIComponent(agent)}`);
	}

	async complete(agent: string, result?: string): Promise<CompleteResult> {
		return this.request("/tasks/complete", {
			method: "POST",
			body: JSON.stringify({ agent, result }),
		});
	}

	async kill(taskId: number): Promise<{ killed: boolean }> {
		return this.request("/tasks/kill", {
			method: "POST",
			body: JSON.stringify({ taskId }),
		});
	}

	async overview(): Promise<TaskOverviewItem[]> {
		return this.request("/tasks/overview");
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			...init,
			headers: { "content-type": "application/json" },
		});
		const text = await response.text();
		const data = text ? JSON.parse(text) : undefined;
		if (!response.ok) {
			throw new Error(data?.error ?? `Bus task request failed: HTTP ${response.status}`);
		}
		return data as T;
	}
}
