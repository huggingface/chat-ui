/** parent side of the gradio-console protocol v1, which gradio implements as the frame */

export const GRADIO_CONSOLE_PROTOCOL = "gradio-console";
export const GRADIO_CONSOLE_VERSION = 1;

/** init goes out on load and again at these offsets until an ack arrives */
export const INIT_RETRY_MS = [500, 1500, 3000] as const;
export const UNSUPPORTED_AFTER_MS = 5000;

const TEXT_MAX = 4096;

export type FrameConsoleState = "connecting" | "connected" | "unsupported";

export interface ConsoleEntry {
	session_id: string;
	seq: number;
	ts: number;
	level: string;
	text: string;
	stack?: string;
}

export type ConsoleMessage =
	| { type: "ack"; session_id: string; gradio_version: string; dropped: number }
	| { type: "entries"; session_id: string; entries: ConsoleEntry[]; dropped: number };

const clip = (text: string) =>
	text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 12)}…[truncated]` : text;
const count = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** a frame message or null to ignore it, a higher version is read for the fields v1 knows */
export function parseConsoleMessage(data: unknown): ConsoleMessage | null {
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	const msg = data as Record<string, unknown>;
	if (msg.protocol !== GRADIO_CONSOLE_PROTOCOL) return null;
	const sessionId = msg.session_id;
	if (typeof sessionId !== "string" || !sessionId) return null;
	if (msg.type === "ack") {
		return {
			type: "ack",
			session_id: sessionId,
			gradio_version: typeof msg.gradio_version === "string" ? msg.gradio_version : "",
			dropped: count(msg.dropped),
		};
	}
	if (msg.type === "entries") {
		if (!Array.isArray(msg.entries)) return null;
		const entries: ConsoleEntry[] = [];
		for (const raw of msg.entries) {
			if (!raw || typeof raw !== "object") continue;
			const { seq, ts, level, text, stack } = raw as Record<string, unknown>;
			if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) continue;
			if (typeof text !== "string" || typeof level !== "string" || !level) continue;
			entries.push({
				session_id: sessionId,
				seq,
				ts: typeof ts === "number" && Number.isFinite(ts) ? ts : Date.now(),
				level: level.slice(0, 32),
				text: clip(text),
				...(typeof stack === "string" && stack ? { stack: clip(stack) } : {}),
			});
		}
		return { type: "entries", session_id: sessionId, entries, dropped: count(msg.dropped) };
	}
	return null;
}

export interface ConsoleReceiverOptions {
	/** messages from any other window are ignored */
	frame: () => MessageEventSource | null | undefined;
	/** the frame exact origin */
	origin: string;
	onState: (state: FrameConsoleState, ack?: { session_id: string; gradio_version: string }) => void;
	/** new entries only, a session_id and seq already delivered is dropped */
	onEntries: (entries: ConsoleEntry[], dropped: number) => void;
}

export interface ConsoleReceiver {
	/** call on every iframe load, a reload restarts the handshake */
	load(): void;
	handleMessage(event: MessageEvent): void;
	dispose(): void;
}

export function createConsoleReceiver(options: ConsoleReceiverOptions): ConsoleReceiver {
	const { frame, origin, onState, onEntries } = options;
	const seen = new Map<string, Set<number>>();
	let timers: ReturnType<typeof setTimeout>[] = [];
	let acked = false;
	let ackedSession: string | undefined;

	const clearTimers = () => {
		for (const timer of timers) clearTimeout(timer);
		timers = [];
	};

	const sendInit = () => {
		const target = frame() as Window | null | undefined;
		try {
			target?.postMessage(
				{ protocol: GRADIO_CONSOLE_PROTOCOL, version: GRADIO_CONSOLE_VERSION, type: "init" },
				origin
			);
		} catch {
			// a frame that navigated off the origin
		}
	};

	return {
		load() {
			clearTimers();
			acked = false;
			ackedSession = undefined;
			onState("connecting");
			sendInit();
			for (const delay of INIT_RETRY_MS) {
				timers.push(setTimeout(() => !acked && sendInit(), delay));
			}
			timers.push(
				setTimeout(() => {
					if (!acked) onState("unsupported");
				}, UNSUPPORTED_AFTER_MS)
			);
		},

		handleMessage(event) {
			const source = frame();
			if (!source || event.source !== source || event.origin !== origin) return;
			const message = parseConsoleMessage(event.data);
			if (!message) return;
			if (message.type === "ack") {
				acked = true;
				clearTimers();
				if (message.session_id !== ackedSession) {
					ackedSession = message.session_id;
					onState("connected", {
						session_id: message.session_id,
						gradio_version: message.gradio_version,
					});
				}
				if (message.dropped) onEntries([], message.dropped);
				return;
			}
			let session = seen.get(message.session_id);
			if (!session) seen.set(message.session_id, (session = new Set()));
			const fresh = message.entries.filter((entry) => {
				if (session.has(entry.seq)) return false;
				session.add(entry.seq);
				return true;
			});
			if (fresh.length || message.dropped) onEntries(fresh, message.dropped);
		},

		dispose() {
			clearTimers();
		},
	};
}
