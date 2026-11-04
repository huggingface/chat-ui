import type { Message } from "$lib/types/Message";
import { ToolResultStatus } from "$lib/types/Tool";
import { isMessageToolResultUpdate } from "$lib/utils/messageUpdates";
import { spaceIdToEmbedOrigin } from "$lib/utils/trackio";

const SPACE_PAGE_REGEX = /https:\/\/huggingface\.co\/spaces\/([A-Za-z0-9][\w.-]*)\/([\w-]+)/;

/** A gr.Workflow Space `create_workflow` wrote, framed in the workflow pane. */
export interface WorkflowSpace {
	/** Embeddable `https://<owner>-<name>.hf.space/?ui=canvas` URL. */
	url: string;
	label: string;
	spaceId: string;
	messageId: Message["id"];
}

/**
 * Every gr.Workflow Space `create_workflow` wrote in the visible conversation,
 * oldest first. Read from the tool's own output, which chat-ui writes, never
 * from the model's prose.
 */
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

/**
 * Headers that make a ZeroGPU Space bill the signed-in visitor's quota, as the
 * Hub's Space page provides. Encrypted for the Spaces proxy, so the Space can't
 * read them. Empty without a Hub session, which gradio treats as a guest.
 */
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
 * Answers a framed workflow Space as the Hub's Space page would: an inference
 * token for model nodes, ZeroGPU headers for Space nodes.
 *
 * Only a Space in the viewer's own namespace is answered: a shared conversation
 * frames its author's Space in every viewer's pane, and that author could edit
 * it to spend viewers' credits. Others get a null token, so they run as a guest.
 */
export function workflowTokenHandler({
	frame,
	origin,
	spaceId,
	viewer,
}: {
	frame: () => MessageEventSource | null | undefined;
	origin: string;
	spaceId: string;
	viewer: string | undefined;
}): (event: MessageEvent) => Promise<void> {
	const trusted = !!viewer && spaceId.split("/")[0] === viewer;
	const session = crypto.randomUUID();
	// As on the Hub, a hidden tab gets nothing.
	const visible = () => !globalThis.document?.hidden;
	let jwt: { token: string; exp: number } | null = null;
	// Lasts 180s; the Space page refreshes at a third.
	let zeroGpu: { at: number; headers: Record<string, string> } | undefined;

	return async (event) => {
		if (!event.source || event.source !== frame() || event.origin !== origin) return;
		const source = event.source as Window;
		if (event.data === ZEROGPU_SUPPORT_MESSAGE) {
			if (trusted) source.postMessage(ZEROGPU_SUPPORT_MESSAGE, origin);
			return;
		}
		if (event.data === ZEROGPU_HEADERS_MESSAGE) {
			if (!zeroGpu || Date.now() - zeroGpu.at > 60_000) {
				const headers = trusted && visible() ? await fetchZeroGpuHeaders(spaceId, session) : {};
				zeroGpu = Object.keys(headers).length ? { at: Date.now(), headers } : undefined;
			}
			// Always answer: gradio waits on this port with no timeout, so silence hangs the run.
			event.ports[0]?.postMessage(zeroGpu?.headers ?? {});
			return;
		}
		if ((event.data as { type?: unknown })?.type !== INFERENCE_JWT_REQUEST) return;
		if (trusted && visible() && (!jwt || jwt.exp * 1000 - Date.now() < 30_000)) {
			jwt = await fetchInferenceToken();
		}
		const reply = trusted ? jwt : null;
		source.postMessage(
			{ type: INFERENCE_JWT_RESPONSE, token: reply?.token ?? null, exp: reply?.exp },
			origin
		);
	};
}
