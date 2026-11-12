/** the gradio-console v1 pull model frame side, install is serialized with toString so it must not reach outside its body */

export interface FrameFixtureOptions {
	gradioVersion?: string;
	/** ignore gets for this long after boot, like a gr.Server page that connects late */
	answerAfterMs?: number;
}

function install(
	win: Window & { console: Console; __gets?: unknown[]; __sessionId?: string },
	options: FrameFixtureOptions
) {
	if (win.parent === win) return;
	const PROTOCOL = "gradio-console";
	const BUFFER_MAX = 100;
	const TEXT_MAX = 4096;
	const bootedAt = Date.now();
	const sessionId = `s-${Math.random().toString(36).slice(2)}`;
	type Entry = { seq: number; ts: number; level: string; text: string; stack?: string };
	const buffer: Entry[] = [];
	let seq = 0;
	let dropped = 0;
	let busy = false;
	const gets: unknown[] = [];
	win.__gets = gets;
	win.__sessionId = sessionId;

	const allowed = (origin: string) =>
		origin === "https://huggingface.co" ||
		/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

	const toText = (args: unknown[]): { text: string; stack?: string } => {
		let stack: string | undefined;
		const parts = args.map((arg) => {
			if (typeof arg === "string") return arg;
			if (arg instanceof Error) {
				stack ??= arg.stack;
				return `${arg.name}: ${arg.message}`;
			}
			try {
				return JSON.stringify(arg) ?? String(arg);
			} catch {
				try {
					return String(arg);
				} catch {
					return "[Unserializable]";
				}
			}
		});
		const text = parts.join(" ").slice(0, TEXT_MAX);
		return { text, ...(stack ? { stack: stack.slice(0, TEXT_MAX) } : {}) };
	};

	const capture = (level: string, args: unknown[]) => {
		if (busy) return;
		busy = true;
		try {
			buffer.push({ seq: ++seq, ts: Date.now(), level, ...toText(args) });
			if (buffer.length > BUFFER_MAX) {
				buffer.shift();
				dropped += 1;
			}
		} catch {
			// never throw into the page
		} finally {
			busy = false;
		}
	};

	for (const level of ["log", "info", "warn", "error", "debug"] as const) {
		const original = win.console[level];
		win.console[level] = function (this: unknown, ...args: unknown[]) {
			original.apply(this, args);
			capture(level, args);
		};
	}
	win.addEventListener("error", (event) => capture("exception", [event.error ?? event.message]));
	win.addEventListener("unhandledrejection", (event) => capture("rejection", [event.reason]));

	win.addEventListener("message", (event) => {
		const data = event.data as Record<string, unknown> | null;
		if (!data || typeof data !== "object" || data.protocol !== PROTOCOL || data.type !== "get") {
			return;
		}
		if (event.source !== win.parent || !allowed(event.origin)) return;
		gets.push(data);
		if (Date.now() - bootedAt < (options.answerAfterMs ?? 0)) return;
		win.parent.postMessage(
			{
				protocol: PROTOCOL,
				version: 1,
				type: "state",
				...(data.id !== undefined ? { id: data.id } : {}),
				session_id: sessionId,
				gradio_version: options.gradioVersion ?? "",
				dropped,
				entries: buffer.slice(),
			},
			event.origin
		);
	});
}

/** a frame document running the fixture, then script */
export function gradioConsoleFrameDoc(options: FrameFixtureOptions = {}, script = ""): string {
	return `<!doctype html><html><body><script>(${install.toString()})(window, ${JSON.stringify(
		options
	)});${script}</script></body></html>`;
}

/** a frame that never heard of the protocol, an old gradio or not gradio */
export function silentFrameDoc(script = ""): string {
	return `<!doctype html><html><body><script>window.__gets = []; window.addEventListener("message", (e) => window.__gets.push(e.data));${script}</script></body></html>`;
}
