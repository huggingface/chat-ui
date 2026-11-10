/** the gradio-console v1 frame side, install is serialized with toString so it must not reach outside its body */

export interface FrameFixtureOptions {
	/** replay resends already sent entries on every init, as a buggy frame would */
	mode?: "normal" | "replay";
	gradioVersion?: string;
}

function install(
	win: Window & { console: Console; __inits?: string[]; __sessionId?: string },
	options: FrameFixtureOptions
) {
	if (win.parent === win) return;
	const PROTOCOL = "gradio-console";
	const BUFFER_MAX = 100;
	const BATCH_MAX = 50;
	const TEXT_MAX = 4096;
	const sessionId = `s-${Math.random().toString(36).slice(2)}`;
	type Entry = { seq: number; ts: number; level: string; text: string; stack?: string };
	const buffer: Entry[] = [];
	let seq = 0;
	let dropped = 0;
	let sentUpTo = 0;
	let parentOrigin: string | undefined;
	let batchTimer: ReturnType<typeof setTimeout> | undefined;
	let busy = false;
	const inits: string[] = [];
	win.__inits = inits;
	win.__sessionId = sessionId;

	const allowed = (origin: string) =>
		origin === "https://huggingface.co" ||
		/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

	const serialize = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
		if (value === null || typeof value !== "object") return value;
		if (seen.has(value)) return "[Circular]";
		if (depth >= 4) return Array.isArray(value) ? "[Array]" : "[Object]";
		seen.add(value);
		try {
			if (Array.isArray(value)) return value.map((v) => serialize(v, depth + 1, seen));
			const out: Record<string, unknown> = {};
			for (const key of Object.keys(value)) {
				out[key] = serialize((value as Record<string, unknown>)[key], depth + 1, seen);
			}
			return out;
		} catch {
			return "[Unserializable]";
		}
	};

	const toText = (args: unknown[]): { text: string; stack?: string } => {
		let stack: string | undefined;
		const parts = args.map((arg) => {
			try {
				if (typeof arg === "string") return arg;
				if (arg instanceof Error) {
					stack ??= arg.stack;
					return `${arg.name}: ${arg.message}`;
				}
				if (typeof arg === "function") return `[Function ${arg.name}]`;
				if (arg && typeof arg === "object") return JSON.stringify(serialize(arg));
				return String(arg);
			} catch {
				return "[Unserializable]";
			}
		});
		let text = parts.join(" ");
		if (text.length > TEXT_MAX) text = `${text.slice(0, TEXT_MAX - 12)}…[truncated]`;
		return { text, ...(stack ? { stack: stack.slice(0, TEXT_MAX) } : {}) };
	};

	const post = (message: Record<string, unknown>) => {
		if (!parentOrigin) return;
		win.parent.postMessage({ protocol: PROTOCOL, version: 1, ...message }, parentOrigin);
	};

	const flush = () => {
		clearTimeout(batchTimer);
		batchTimer = undefined;
		const unsent = buffer.filter((entry) => entry.seq > sentUpTo);
		for (let i = 0; i < unsent.length; i += BATCH_MAX) {
			const chunk = unsent.slice(i, i + BATCH_MAX);
			post({ type: "entries", session_id: sessionId, entries: chunk, dropped });
			dropped = 0;
			sentUpTo = chunk[chunk.length - 1].seq;
		}
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
			if (!parentOrigin) return;
			if (buffer.filter((entry) => entry.seq > sentUpTo).length >= BATCH_MAX) flush();
			else batchTimer ??= setTimeout(flush, 250);
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
		if (!data || typeof data !== "object" || data.protocol !== PROTOCOL || data.type !== "init") {
			return;
		}
		if (event.source !== win.parent || !allowed(event.origin)) return;
		inits.push(event.origin);
		parentOrigin = event.origin;
		post({
			type: "ack",
			session_id: sessionId,
			gradio_version: options.gradioVersion ?? "",
			dropped: 0,
		});
		if (options.mode === "replay") sentUpTo = 0;
		flush();
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
	return `<!doctype html><html><body><script>window.__inits = []; window.addEventListener("message", (e) => window.__inits.push(e.data));${script}</script></body></html>`;
}
