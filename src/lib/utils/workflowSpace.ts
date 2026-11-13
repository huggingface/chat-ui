import type { Message } from "$lib/types/Message";
import { ToolResultStatus } from "$lib/types/Tool";
import { isMessageToolResultUpdate } from "$lib/utils/messageUpdates";
import { spaceIdToEmbedOrigin } from "$lib/utils/trackio";

const SPACE_PAGE_REGEX = /https:\/\/huggingface\.co\/spaces\/([A-Za-z0-9][\w.-]*)\/([\w-]+)/;

export interface WorkflowSpace {
	url: string;
	label: string;
	spaceId: string;
	messageId: Message["id"];
}

/** Read from the tool's own output, never the model's prose. */
export function collectWorkflowSpaces(
	messages: Array<Pick<Message, "id" | "from" | "updates">>
): WorkflowSpace[] {
	const found = new Map<string, WorkflowSpace>();
	for (const message of messages) {
		if (message.from !== "assistant") continue;
		for (const update of message.updates ?? []) {
			if (!isMessageToolResultUpdate(update)) continue;
			const { result } = update;
			if (result.status !== ToolResultStatus.Success) continue;
			if (result.call.name !== "create_workflow") continue;
			for (const output of result.outputs) {
				const text = output["text"];
				const match = typeof text === "string" ? text.match(SPACE_PAGE_REGEX) : null;
				if (!match) continue;
				const origin = spaceIdToEmbedOrigin(match[1], match[2]);
				if (!origin) continue;
				const url = `${origin}/?ui=canvas`;
				if (found.has(url)) continue;
				const spaceId = `${match[1]}/${match[2]}`;
				found.set(url, { url, label: spaceId, spaceId, messageId: message.id });
			}
		}
	}
	return [...found.values()];
}

export const INFERENCE_JWT_REQUEST = "INFERENCE_JWT_REQUEST";
export const INFERENCE_JWT_RESPONSE = "INFERENCE_JWT_RESPONSE";
export const INFERENCE_JWT_PROBE = "INFERENCE_JWT_PROBE";
export const INFERENCE_JWT_PROBE_RESPONSE = "INFERENCE_JWT_PROBE_RESPONSE";

export async function fetchInferenceToken(): Promise<{ token: string; exp: number } | null> {
	try {
		const res = await fetch("https://huggingface.co/api/settings/jwt-inference-only", {
			credentials: "include",
		});
		if (!res.ok) return null;
		const body = await res.json();
		return typeof body.accessToken === "string" && typeof body.exp === "number"
			? { token: body.accessToken, exp: body.exp }
			: null;
	} catch {
		return null;
	}
}

export const ZEROGPU_SUPPORT_MESSAGE = "supports-zerogpu-headers";
export const ZEROGPU_HEADERS_MESSAGE = "zerogpu-headers";

/** Bills ZeroGPU to the signed-in visitor, as the Hub's Space page does. */
export async function fetchZeroGpuHeaders(
	spaceId: string,
	session: string
): Promise<Record<string, string>> {
	try {
		const res = await fetch(
			`https://huggingface.co/api/spaces/${spaceId}/jwt?expires_in=180&billing_details=true&encrypted=true`,
			{ credentials: "include" }
		);
		if (!res.ok) return {};
		const { encryptedToken: t } = await res.json();
		if (!t?.keyId || !t?.encrypted) return {};
		return { "X-ZeroGPU-Token": `${t.keyId}:${t.encrypted}`, "X-ZeroGPU-UUID": session };
	} catch {
		return {};
	}
}

/**
 * Answers a framed workflow Space as the Hub's Space page would. As on the Hub,
 * a Space the viewer doesn't own gets the inference token only after `consent`.
 */
export function workflowTokenHandler({
	frame,
	origin,
	spaceId,
	viewer,
	consent,
}: {
	frame: () => MessageEventSource | null | undefined;
	origin: string;
	spaceId: string;
	viewer: string | undefined;
	consent: (ask: boolean) => boolean | Promise<boolean>;
}): (event: MessageEvent) => Promise<void> {
	const owned = !!viewer && spaceId.split("/")[0] === viewer;
	const session = crypto.randomUUID();
	const visible = () => !globalThis.document?.hidden;
	let allowed: Promise<boolean> | undefined;
	let jwt: Promise<{ token: string; exp: number } | null> | undefined;
	let zeroGpu: { at: number; headers: Promise<Record<string, string>> } | undefined;

	async function inferenceToken() {
		const current = (jwt ??= fetchInferenceToken());
		const value = await current;
		if (value && value.exp * 1000 - Date.now() > 30_000) return value;
		if (jwt === current) jwt = value ? fetchInferenceToken() : undefined;
		return value && jwt;
	}

	async function zeroGpuHeaders() {
		if (!zeroGpu || Date.now() - zeroGpu.at > 60_000) {
			zeroGpu = { at: Date.now(), headers: fetchZeroGpuHeaders(spaceId, session) };
		}
		const current = zeroGpu;
		const headers = await current.headers;
		if (!Object.keys(headers).length && zeroGpu === current) zeroGpu = undefined;
		return headers;
	}

	return async (event) => {
		if (!event.source || event.source !== frame() || event.origin !== origin) return;
		const source = event.source as Window;
		if (event.data === ZEROGPU_SUPPORT_MESSAGE) {
			source.postMessage(ZEROGPU_SUPPORT_MESSAGE, origin);
			return;
		}
		if (event.data === ZEROGPU_HEADERS_MESSAGE) {
			// gradio waits on this port with no timeout.
			event.ports[0]?.postMessage(visible() ? await zeroGpuHeaders() : {});
			return;
		}
		const type = (event.data as { type?: unknown })?.type;
		if (type === INFERENCE_JWT_PROBE) {
			const reply =
				visible() && (owned || (await (allowed ?? consent(false)))) ? await inferenceToken() : null;
			source.postMessage(
				{ type: INFERENCE_JWT_PROBE_RESPONSE, token: reply?.token ?? null, exp: reply?.exp },
				origin
			);
			return;
		}
		if (type !== INFERENCE_JWT_REQUEST) return;
		const reply =
			visible() && (await (allowed ??= Promise.resolve(owned || consent(true))))
				? await inferenceToken()
				: null;
		source.postMessage(
			{ type: INFERENCE_JWT_RESPONSE, token: reply?.token ?? null, exp: reply?.exp },
			origin
		);
	};
}
