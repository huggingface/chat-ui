/** parent side of the gradio-console protocol v1 pull model, which gradio implements as the frame */

export const GRADIO_CONSOLE_PROTOCOL = "gradio-console";
export const GRADIO_CONSOLE_VERSION = 1;

/** after load, get goes out again at these offsets until a state arrives */
export const GET_RETRY_MS = [500, 1500] as const;
/** a get at load is answered before the app has booted, so this one always goes out and carries any check */
export const STARTUP_GET_MS = 3000;
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

export interface ConsoleState {
	id?: string | number;
	session_id: string;
	gradio_version: string;
	/** total the frame evicted since its page load */
	dropped: number;
	entries: ConsoleEntry[];
}

const clip = (text: string) =>
	text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 12)}…[truncated]` : text;
const count = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** a frame state or null to ignore the message, a higher version is read for the fields v1 knows */
export function parseConsoleState(data: unknown): ConsoleState | null {
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	const msg = data as Record<string, unknown>;
	if (msg.protocol !== GRADIO_CONSOLE_PROTOCOL || msg.type !== "state") return null;
	const sessionId = msg.session_id;
	if (typeof sessionId !== "string" || !sessionId) return null;
	const entries: ConsoleEntry[] = [];
	for (const raw of Array.isArray(msg.entries) ? msg.entries : []) {
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
	return {
		...(typeof msg.id === "string" || typeof msg.id === "number" ? { id: msg.id } : {}),
		session_id: sessionId,
		gradio_version: typeof msg.gradio_version === "string" ? msg.gradio_version : "",
		dropped: count(msg.dropped),
		entries,
	};
}

export interface ConsoleReceiverOptions {
	/** messages from any other window are ignored */
	frame: () => MessageEventSource | null | undefined;
	/** the frame exact origin */
	origin: string;
	onState: (
		state: FrameConsoleState,
		reply?: { session_id: string; gradio_version: string }
	) => void;
	/** every state reply, with only the entries not delivered before */
	onSnapshot: (snapshot: ConsoleState) => void;
}

export interface ConsoleReceiver {
	/** call on every iframe load, a reload restarts the sequence */
	load(id?: string): void;
	/** a get carrying id, held until STARTUP_GET_MS after load, a reply to it upgrades an unsupported frame */
	request(id: string): void;
	handleMessage(event: MessageEvent): void;
	dispose(): void;
}

export function createConsoleReceiver(options: ConsoleReceiverOptions): ConsoleReceiver {
	const { frame, origin, onState, onSnapshot } = options;
	const seen = new Map<string, Set<number>>();
	let timers: ReturnType<typeof setTimeout>[] = [];
	let answered = false;
	let session: string | undefined;
	let loadedAt: number | undefined;
	let pendingId: string | undefined;

	const clearTimers = () => {
		for (const timer of timers) clearTimeout(timer);
		timers = [];
	};

	const sendGet = (id?: string) => {
		const target = frame() as Window | null | undefined;
		try {
			target?.postMessage(
				{
					protocol: GRADIO_CONSOLE_PROTOCOL,
					version: GRADIO_CONSOLE_VERSION,
					type: "get",
					...(id !== undefined ? { id } : {}),
				},
				origin
			);
		} catch {
			// a frame that navigated off the origin
		}
	};

	return {
		load(id) {
			clearTimers();
			answered = false;
			session = undefined;
			loadedAt = Date.now();
			pendingId = id;
			onState("connecting");
			sendGet();
			for (const delay of GET_RETRY_MS) {
				timers.push(setTimeout(() => !answered && sendGet(), delay));
			}
			timers.push(
				setTimeout(() => {
					const held = pendingId;
					pendingId = undefined;
					sendGet(held);
				}, STARTUP_GET_MS)
			);
			timers.push(
				setTimeout(() => {
					if (!answered) onState("unsupported");
				}, UNSUPPORTED_AFTER_MS)
			);
		},

		request(id) {
			if (loadedAt !== undefined && Date.now() - loadedAt < STARTUP_GET_MS) pendingId = id;
			else sendGet(id);
		},

		handleMessage(event) {
			const source = frame();
			if (!source || event.source !== source || event.origin !== origin) return;
			const state = parseConsoleState(event.data);
			if (!state) return;
			answered = true;
			if (state.session_id !== session) {
				session = state.session_id;
				onState("connected", {
					session_id: state.session_id,
					gradio_version: state.gradio_version,
				});
			}
			let seqs = seen.get(state.session_id);
			if (!seqs) seen.set(state.session_id, (seqs = new Set()));
			const known = seqs;
			onSnapshot({
				...state,
				entries: state.entries.filter((entry) => {
					if (known.has(entry.seq)) return false;
					known.add(entry.seq);
					return true;
				}),
			});
		},

		dispose() {
			clearTimers();
		},
	};
}
