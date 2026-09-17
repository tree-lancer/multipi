import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskClient, TaskOverviewItem } from "./client";

// Widget below the editor with q (close) / r (refresh) key handling via onTerminalInput.
// Keys are only consumed while the panel is visible AND the editor is empty, so typing
// "query" or "review" into the editor is never stolen.
const WIDGET_KEY = "multipi-tasks";

function renderOverview(tasks: TaskOverviewItem[]): string[] {
	if (tasks.length === 0) return ["No active tasks on the bus."];
	const lines: string[] = [];
	for (const task of tasks) {
		lines.push(`Task #${task.id}  publisher: ${task.publisher}  created: ${task.createdAt}${task.timeoutAt ? `  timeout: ${task.timeoutAt}` : ""}`);
		lines.push(`  background: ${task.background.split("\n")[0]}`);
		for (const a of task.assignments) {
			lines.push(`  - ${a.agent_name}  [${a.status}]`);
		}
	}
	lines.push("(r: refresh  q: close)");
	return lines;
}

export function registerMultipiTasksCommand(pi: ExtensionAPI, client: TaskClient) {
	let visible = false;
	let activeCtx: ExtensionContext | undefined;
	let unsubscribe: (() => void) | undefined;

	const setWidget = (tasks: TaskOverviewItem[] | undefined) => {
		activeCtx?.ui.setWidget(WIDGET_KEY, tasks === undefined ? undefined : renderOverview(tasks), { placement: "belowEditor" });
	};

	const refresh = async () => {
		if (!activeCtx) return;
		try {
			const tasks = await client.overview();
			setWidget(tasks);
		} catch (error) {
			activeCtx.ui.notify(`Failed to load tasks: ${(error as Error).message}`, "error");
		}
	};

	const hide = () => {
		visible = false;
		setWidget(undefined);
	};

	pi.registerCommand("multipi-tasks", {
		description: "Toggle an overview of active bus tasks below the editor (r: refresh, q: close)",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			activeCtx = ctx;
			if (visible) {
				hide();
				return;
			}
			visible = true;
			await refresh();
			if (unsubscribe) return;
			unsubscribe = ctx.ui.onTerminalInput((data) => {
				if (!visible) return undefined;
				// Only act on bare single-key presses while the editor is empty,
				// so normal typing is never intercepted.
				if ((activeCtx?.ui.getEditorText() ?? "") !== "") return undefined;
				if (data === "q" || data === "\x1b") {
					hide();
					return { consume: true };
				}
				if (data === "r") {
					void refresh();
					return { consume: true };
				}
				return undefined;
			});
		},
	});
}
