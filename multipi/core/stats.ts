export type BusStatusUI = {
	setStatus?: (key: string, text: string | undefined) => void;
	theme?: { fg?: (name: string, text: string) => string };
};

export class BusStats {
	private sent = 0;
	private received = 0;

	addSent(count: number): void {
		this.sent += Math.max(0, Math.floor(count));
	}

	addReceived(count: number): void {
		this.received += Math.max(0, Math.floor(count));
	}

	render(ui?: BusStatusUI): string {
		const text = `↑${this.sent} ↓${this.received}`;
		return ui?.theme?.fg ? ui.theme.fg("dim", text) : text;
	}

	update(ui?: BusStatusUI): void {
		// setStatus renders in the footer status line. The key is prefixed with
		// z- so it is appended after earlier extension statuses in insertion order.
		ui?.setStatus?.("z-bus", this.render(ui));
	}

	clear(ui?: BusStatusUI): void {
		ui?.setStatus?.("z-bus", undefined);
	}
}
