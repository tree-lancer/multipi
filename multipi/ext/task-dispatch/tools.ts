import { Type } from "typebox";
import type { AgentState } from "../../core/agents";
import { TaskClient } from "./client";

const PublishTaskParams = Type.Object({
	background: Type.String({
		description:
			"Public task description shared by every assignee: the playbook context, goal, constraints, and coordination rules.",
	}),
	assignments: Type.Record(Type.String(), Type.String(), {
		description:
			"Map of agent name to that agent's specific assignment. Every named agent must be registered and not enrolled in another active task. The publisher may include itself.",
	}),
	timeout_minutes: Type.Optional(
		Type.Number({ description: "Optional task timeout in minutes. On timeout the task is marked failed and all agents are released. Defaults to no timeout." }),
	),
});

const CompleteTaskParams = Type.Object({
	result: Type.Optional(
		Type.String({ description: "Short summary of the completed work, e.g. changed files, commands run, known risks." }),
	),
});

const KillTaskParams = Type.Object({
	task_id: Type.Number({ description: "ID of the active task to force-mark as over, releasing all its agents." }),
});

export function createTaskTools(client: TaskClient, state: AgentState) {
	const publishTask = {
		name: "publish_task",
		label: "Publish Task",
		description:
			"Publish a dispatch task on the bus: one public background description plus a per-agent assignment map. The bus atomically validates that every assignee is registered and idle, then wakes each assignee (except the publisher) with a system message.",
		promptSnippet: "Publish a task with a public background and per-agent assignments.",
		promptGuidelines: [
			"Use publish_task to distribute a playbook across agents; each assignee sees the background plus only its own assignment via get_task.",
		],
		parameters: PublishTaskParams,
		async execute(_id: string, params: { background: string; assignments: Record<string, string>; timeout_minutes?: number }) {
			const self = state.require();
			const result = await client.publish(self.name, params.background, params.assignments, params.timeout_minutes ?? 0);
			return {
				content: [{
					type: "text" as const,
					text: `Task #${result.taskId} published to ${Object.keys(params.assignments).length} agent(s). Assignees have been notified.`,
				}],
				details: result,
			};
		},
	};

	const getTask = {
		name: "get_task",
		label: "Get Task",
		description: "View your current active task: the public background plus your own assignment spec.",
		promptSnippet: "View your current task assignment.",
		promptGuidelines: [
			"Call get_task when you receive a '[system] New task' prompt or need to re-read your assignment.",
		],
		parameters: Type.Object({}),
		async execute() {
			const self = state.require();
			const current = await client.current(self.name);
			if (!current.task) {
				return { content: [{ type: "text" as const, text: `No active task for '${self.name}'.` }], details: { task: null } };
			}
			const text = [
				`Task #${current.task.id} (publisher: ${current.task.publisher})`,
				"",
				"## Background",
				current.task.background,
				"",
				"## Your assignment",
				current.assignment?.spec ?? "",
			].join("\n");
			return { content: [{ type: "text" as const, text }], details: current };
		},
	};

	const completeTask = {
		name: "complete_task",
		label: "Complete Task",
		description:
			"Mark your part of the current active task as done with a short result summary. When every assignment is done, the bus archives the task automatically.",
		promptSnippet: "Mark your assignment of the current task as done.",
		promptGuidelines: [
			"Call complete_task after finishing your assignment; include changed files and risks in result.",
		],
		parameters: CompleteTaskParams,
		async execute(_id: string, params: { result?: string }) {
			const self = state.require();
			const result = await client.complete(self.name, params.result);
			if (!result.completed) {
				return { content: [{ type: "text" as const, text: `No pending task assignment for '${self.name}'.` }], details: result };
			}
			const text = result.taskCompleted
				? `Task #${result.taskId} is now complete and archived.`
				: `Your assignment in task #${result.taskId} is marked done. Waiting on other assignees.`;
			return { content: [{ type: "text" as const, text }], details: result };
		},
	};

	const killTask = {
		name: "kill_task",
		label: "Kill Task",
		description:
			"Force-mark an active task as over and release all of its agents. Use when a task is stuck or abandoned.",
		promptSnippet: "Force-terminate an active task.",
		promptGuidelines: [
			"Use kill_task to force-finish a stuck task; all agents are released immediately.",
		],
		parameters: KillTaskParams,
		async execute(_id: string, params: { task_id: number }) {
			const result = await client.kill(params.task_id);
			return {
				content: [{
					type: "text" as const,
					text: result.killed
						? `Task #${params.task_id} was force-marked as over and its agents released.`
						: `Task #${params.task_id} is not an active task.`,
				}],
				details: result,
			};
		},
	};

	return { publishTask, getTask, completeTask, killTask };
}
