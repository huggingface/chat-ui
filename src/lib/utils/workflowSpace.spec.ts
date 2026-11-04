import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	collectWorkflowSpaces,
	fetchInferenceToken,
	fetchZeroGpuHeaders,
	workflowTokenHandler,
} from "$lib/utils/workflowSpace";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";

const result = (name: string, text: string): MessageUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Result,
	uuid: "u1",
	result: {
		status: ToolResultStatus.Success,
		call: { name, parameters: {} },
		outputs: [{ text }],
		display: true,
	},
});

const WRITTEN =
	"Public workflow Space written: https://huggingface.co/spaces/hmb/flux-vs-krea-workflow — tell the user it is public.";

describe("collectWorkflowSpaces", () => {
	it("frames the Space create_workflow wrote", () => {
		const found = collectWorkflowSpaces([
			{ id: "m1", from: "assistant", updates: [result("create_workflow", WRITTEN)] },
		]);

		expect(found).toEqual([
			{
				url: "https://hmb-flux-vs-krea-workflow.hf.space/?ui=canvas",
				label: "hmb/flux-vs-krea-workflow",
				spaceId: "hmb/flux-vs-krea-workflow",
				messageId: "m1",
			},
		]);
	});

	it("ignores the same URL from any other tool", () => {
		expect(
			collectWorkflowSpaces([
				{ id: "m1", from: "assistant", updates: [result("hf_jobs", WRITTEN)] },
			])
		).toEqual([]);
	});
});

describe("fetchInferenceToken", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("returns the Hub's short-lived inference token", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ accessToken: "hf_jwt_x", exp: 1793367730 }))
		);
		expect(await fetchInferenceToken()).toEqual({ token: "hf_jwt_x", exp: 1793367730 });
	});

	it("returns null without a Hub session", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 401 }))
		);
		expect(await fetchInferenceToken()).toBeNull();
	});
});

describe("fetchZeroGpuHeaders", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("asks for an encrypted Space token and returns the proxy's headers", async () => {
		const fetch = vi.fn(async () =>
			Response.json({ encryptedToken: { keyId: "k1", encrypted: "enc" }, exp: 1 })
		);
		vi.stubGlobal("fetch", fetch);

		expect(await fetchZeroGpuHeaders("hmb/wf", "s1")).toEqual({
			"X-ZeroGPU-Token": "k1:enc",
			"X-ZeroGPU-UUID": "s1",
		});
		expect(fetch).toHaveBeenCalledWith(
			"https://huggingface.co/api/spaces/hmb/wf/jwt?expires_in=180&billing_details=true&encrypted=true",
			{ credentials: "include" }
		);
	});

	it("returns no headers without a Hub session, so gradio runs as a guest", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 401 }))
		);
		expect(await fetchZeroGpuHeaders("hmb/wf", "s1")).toEqual({});
	});
});

describe("workflowTokenHandler", () => {
	const ORIGIN = "https://hmb-wf.hf.space";
	let frame: { postMessage: ReturnType<typeof vi.fn> };
	const fetch = vi.fn(async (url: string) =>
		url.includes("jwt-inference-only")
			? Response.json({ accessToken: "hf_jwt_x", exp: Date.now() / 1000 + 600 })
			: Response.json({ encryptedToken: { keyId: "k", encrypted: "e" } })
	);

	const handler = (overrides: { spaceId?: string; viewer?: string } = {}) =>
		workflowTokenHandler({
			frame: () => frame as never,
			origin: ORIGIN,
			spaceId: "hmb/wf",
			viewer: "hmb",
			...overrides,
		});
	const message = (data: unknown, overrides: Partial<MessageEvent> = {}) =>
		({ data, origin: ORIGIN, source: frame, ports: [], ...overrides }) as unknown as MessageEvent;

	beforeEach(() => {
		frame = { postMessage: vi.fn() };
		fetch.mockClear();
		vi.stubGlobal("fetch", fetch);
	});
	afterEach(() => vi.unstubAllGlobals());

	it("answers the viewer's own Space, only at its origin", async () => {
		const port = { postMessage: vi.fn() };
		const onMessage = handler();
		await onMessage(message("supports-zerogpu-headers"));
		await onMessage(message("zerogpu-headers", { ports: [port as never] }));
		await onMessage(message({ type: "INFERENCE_JWT_REQUEST" }));

		expect(frame.postMessage).toHaveBeenCalledWith("supports-zerogpu-headers", ORIGIN);
		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ "X-ZeroGPU-Token": "k:e" })
		);
		expect(frame.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "INFERENCE_JWT_RESPONSE", token: "hf_jwt_x" }),
			ORIGIN
		);
	});

	it.each([
		["another window", { source: {} as never }],
		["another origin", { origin: "https://evil.hf.space" }],
	])("ignores a message from %s", async (_, overrides) => {
		await handler()(message({ type: "INFERENCE_JWT_REQUEST" }, overrides));

		expect(fetch).not.toHaveBeenCalled();
		expect(frame.postMessage).not.toHaveBeenCalled();
	});

	it.each([
		["someone else's Space", "mallory/wf", "hmb"],
		["a signed-out viewer", "hmb/wf", undefined],
	])("gives %s no token and no ZeroGPU handshake", async (_, spaceId, viewer) => {
		const port = { postMessage: vi.fn() };
		const onMessage = handler({ spaceId, viewer });
		await onMessage(message("supports-zerogpu-headers"));
		await onMessage(message("zerogpu-headers", { ports: [port as never] }));
		await onMessage(message({ type: "INFERENCE_JWT_REQUEST" }));

		expect(fetch).not.toHaveBeenCalled();
		// Still answered, so gradio runs as a guest instead of waiting.
		expect(port.postMessage).toHaveBeenCalledWith({});
		expect(frame.postMessage).toHaveBeenCalledTimes(1);
		expect(frame.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "INFERENCE_JWT_RESPONSE", token: null }),
			ORIGIN
		);
	});
});
