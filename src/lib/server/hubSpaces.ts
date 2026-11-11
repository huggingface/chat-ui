const HUB = "https://huggingface.co";

export const SPACE_ID = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;

const SPACE_HOST = /^https:\/\/[a-z0-9][a-z0-9-]*\.hf\.space$/;

export interface HubSpace {
	id: string;
	sdk?: string;
	/** only set for an hf.space origin, the one host a token may follow */
	host?: string;
	private: boolean;
	stage?: string;
	/** the hub reason for an error stage, often with the traceback */
	errorMessage?: string;
}

export function isSpaceHost(host: unknown): host is string {
	return typeof host === "string" && SPACE_HOST.test(host);
}

function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
	return AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(ms)]);
}

/** the space as the hub reports it, or a sentence for the model on why it cannot be read */
export async function lookupSpace(
	id: string,
	token: string | undefined,
	signal?: AbortSignal
): Promise<HubSpace | string> {
	let response: Response;
	try {
		response = await fetch(`${HUB}/api/spaces/${id}`, {
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			signal: withTimeout(15_000, signal),
		});
	} catch (err) {
		return `Could not look up ${id}: ${String(err)}`;
	}
	// the hub answers 401 for a missing space too
	if (!response.ok) return `${id} does not resolve on the Hub (${response.status}).`;
	const info: {
		sdk?: string;
		host?: string;
		private?: boolean;
		runtime?: { stage?: string; errorMessage?: string };
	} = await response.json().catch(() => ({}));
	return {
		id,
		sdk: info.sdk,
		...(isSpaceHost(info.host) ? { host: info.host } : {}),
		private: info.private === true,
		stage: info.runtime?.stage,
		...(info.runtime?.errorMessage ? { errorMessage: info.runtime.errorMessage } : {}),
	};
}

export type GradioIo = {
	label?: string;
	parameter_name?: string;
	component?: string;
	parameter_has_default?: boolean;
	parameter_default?: unknown;
	example_input?: unknown;
};

export type GradioEndpoints = Record<string, { parameters?: GradioIo[]; returns?: GradioIo[] }>;

/** the token reaches the space code, so pass one only for a private space */
export async function fetchGradioEndpoints(
	space: HubSpace,
	token: string | undefined,
	signal?: AbortSignal
): Promise<GradioEndpoints | string> {
	if (!space.host) return `${space.id} has no app host to call.`;
	try {
		const api = await fetch(`${space.host}/gradio_api/info`, {
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			signal: withTimeout(15_000, signal),
		});
		if (!api.ok) return `${space.id} does not expose a Gradio API (${api.status}).`;
		return (await api.json()).named_endpoints ?? {};
	} catch (err) {
		return `Could not read ${space.id}'s Gradio API: ${String(err)}`;
	}
}

/** endpoints a gradio app wires to its own ui events rather than offers as an api */
const UTILITY_ENDPOINT = /^\/(on|handle|update|prepare|load|clear|reset)_/;

/** the endpoint asked for, else /predict, else the first that is not a ui handler */
export function pickGradioEndpoint(
	spaceId: string,
	named: GradioEndpoints,
	endpoint?: string
): string | { error: string } {
	// utility endpoints are skipped only when picking a default
	const names = Object.keys(named).filter((name) => !UTILITY_ENDPOINT.test(name));
	const name = endpoint ?? (names.includes("/predict") ? "/predict" : names[0]);
	if (!name || !Object.hasOwn(named, name)) {
		return {
			error: `${spaceId} has no ${endpoint ?? "callable"} endpoint${names.length ? ` — it has ${names.join(", ")}` : ""}.`,
		};
	}
	return name;
}

export type SpaceLogKind = "build" | "run";

const LOG_LINE_MAX = 500;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** one sse data payload, a json object with a data field or raw text */
function logText(payload: string): string {
	try {
		const parsed = JSON.parse(payload);
		if (parsed && typeof parsed === "object" && typeof parsed.data === "string") return parsed.data;
		if (typeof parsed === "string") return parsed;
	} catch {
		// raw text
	}
	return payload;
}

/** the endpoint replays the log and then never ends, so it is cut off after windowMs */
export async function readSpaceLogTail(
	id: string,
	kind: SpaceLogKind,
	token: string,
	{
		maxLines = 60,
		windowMs = 5000,
		signal,
	}: { maxLines?: number; windowMs?: number; signal?: AbortSignal } = {}
): Promise<{ lines: string[] } | { error: string }> {
	const cutoff = withTimeout(windowMs, signal);
	let response: Response;
	try {
		response = await fetch(`${HUB}/api/spaces/${id}/logs/${kind}`, {
			headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
			signal: cutoff,
		});
	} catch (err) {
		return { error: `Could not read the ${kind} log: ${String(err)}` };
	}
	if (!response.ok || !response.body) {
		const why =
			response.status === 401 || response.status === 403
				? "this sign-in cannot read it"
				: `status ${response.status}`;
		return { error: `Could not read the ${kind} log (${why}).` };
	}

	const lines: string[] = [];
	const push = (text: string) => {
		for (const raw of text.replace(ANSI, "").split(/\r?\n/)) {
			// a progress bar redraws with a carriage return, keep its last frame
			const line = raw.split("\r").at(-1)?.trimEnd() ?? "";
			if (!line) continue;
			lines.push(line.length > LOG_LINE_MAX ? `${line.slice(0, LOG_LINE_MAX)}…` : line);
			if (lines.length > maxLines) lines.shift();
		}
	};

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const parts = buffer.split("\n");
			buffer = parts.pop() ?? "";
			for (const part of parts) {
				if (part.startsWith("data:")) push(logText(part.slice(5).trimStart()));
			}
		}
	} catch {
		// the cutoff, what was read is the tail
	} finally {
		reader.cancel().catch(() => {});
	}
	if (buffer.startsWith("data:")) push(logText(buffer.slice(5).trimStart()));
	if (signal?.aborted) return { error: "Aborted" };
	return { lines };
}
