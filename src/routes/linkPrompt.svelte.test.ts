import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { writable } from "svelte/store";
import type { Component } from "svelte";
import superjson from "superjson";
import { appNavigation, renderWithApp } from "$lib/components/__tests__/renderWithApp";
import { setPage } from "$lib/components/__tests__/appMocks";
import { loadAttachmentsFromUrls } from "$lib/utils/loadAttachmentsFromUrls";
import { mlAssistant } from "$lib/stores/mlAssistant.svelte";
import HomePage from "./+page.svelte";
import ModelPage from "./models/[...model]/+page.svelte";

vi.mock("$lib/components/chat/ChatWindow.svelte", async () => ({
	default: (await import("$lib/components/__tests__/ChatWindowStub.svelte")).default,
}));
vi.mock("$lib/utils/loadAttachmentsFromUrls", () => ({ loadAttachmentsFromUrls: vi.fn() }));

afterEach(() => {
	mlAssistant.reset();
	mlAssistant.syncConversation(undefined);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

type Loaded = Awaited<ReturnType<typeof loadAttachmentsFromUrls>>;

const LINK = "?q=hello&attachments=https://a.example/file.txt";

function createdResponse(mlAssistant: boolean) {
	return new Response(
		JSON.stringify({
			conversationId: "created",
			conversation: superjson.stringify({
				messages: [],
				title: "New Chat",
				model: "test",
				id: "created",
				updatedAt: new Date(),
				modelId: "test",
				shared: false,
				...(mlAssistant ? { mlAssistant: true } : {}),
			}),
		}),
		{ status: 200 }
	);
}

/**
 * Mounts a route on a `q` link whose attachment fetch stays pending until the
 * test resolves it, with the conversation POST stubbed to succeed.
 */
function mountOnLink(component: Component, url: string, params: Record<string, string> = {}) {
	let resolveAttachments: (value: Loaded) => void = () => {};
	vi.mocked(loadAttachmentsFromUrls)
		.mockReset()
		.mockImplementation(
			() =>
				new Promise<Loaded>((resolve) => {
					resolveAttachments = resolve;
				})
		);
	const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
		const request = JSON.parse(String(init?.body ?? "{}")) as { mlAssistant?: boolean };
		return createdResponse(request.mlAssistant === true);
	});
	vi.stubGlobal("fetch", fetchSpy);

	const settings = Object.assign(
		writable({ activeModel: "test", customPrompts: {}, welcomeModalSeen: true }),
		{ instantSet: vi.fn(async () => undefined) }
	);
	const prepend = vi.fn();
	const context = new Map<unknown, unknown>([
		["settings", settings],
		["conversationsStore", { prepend }],
	]);
	const screen = renderWithApp(
		component,
		{ data: { models: [{ id: "test" }], oldModels: [], mlAssistantModels: ["test"] } } as never,
		{ context, page: { url, params, data: { loginEnabled: false } } }
	);
	return {
		screen,
		fetchSpy,
		prepend,
		resolveAttachments: (value: Loaded) => resolveAttachments(value),
	};
}

async function confirmSend() {
	await tick();
	const send = [...document.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === "Send"
	);
	expect(send).toBeDefined();
	send?.click();
	await tick();
	expect(loadAttachmentsFromUrls).toHaveBeenCalledTimes(1);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const conversationPosts = (fetchSpy: ReturnType<typeof vi.fn>) =>
	fetchSpy.mock.calls.filter(([input]) => String(input).endsWith("/conversation"));

describe.each([
	["home route", HomePage as Component, `/${LINK}`, {}],
	["model route", ModelPage as Component, `/models/test${LINK}`, { model: "test" }],
])("%s", (_name, component, url, params) => {
	it("does not send once the user has left while an attachment was still loading", async () => {
		const { screen, fetchSpy, resolveAttachments } = mountOnLink(component, url, params);
		await confirmSend();

		// The user opens another conversation before the attachment arrives.
		setPage({ url: "/conversation/existing", params: { id: "existing" } });
		await screen.unmount();
		resolveAttachments({ files: [], errors: [] });
		await settle();

		expect(conversationPosts(fetchSpy)).toHaveLength(0);
		expect(appNavigation().goto).not.toHaveBeenCalled();
	});

	it("still sends when the user stays on the page", async () => {
		const { fetchSpy, resolveAttachments } = mountOnLink(component, url, params);
		await confirmSend();

		resolveAttachments({ files: [], errors: [] });
		await settle();

		expect(conversationPosts(fetchSpy)).toHaveLength(1);
		expect(appNavigation().goto).toHaveBeenCalledWith(
			"/conversation/created",
			expect.objectContaining({ state: expect.objectContaining({ pendingMessage: "hello" }) })
		);
	});

	it("persists ML Intern from any first-message callback, then locks on confirmation", async () => {
		const { fetchSpy, prepend } = mountOnLink(component, url.split("?")[0] ?? "/", params);
		let confirmCreate: (response: Response) => void = () => {};
		fetchSpy.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					confirmCreate = resolve;
				})
		);
		mlAssistant.toggle(true);
		const composer = document.querySelector('[data-testid="composer"]') as HTMLTextAreaElement;
		composer.value = "hello";
		composer.dispatchEvent(new Event("input", { bubbles: true }));
		document.querySelector<HTMLButtonElement>('[data-testid="send-message"]')?.click();

		const [[, init]] = conversationPosts(fetchSpy);
		expect(JSON.parse(String(init?.body))).toMatchObject({ mlAssistant: true });
		expect(mlAssistant.taskStarted).toBe(false);

		confirmCreate(createdResponse(true));
		await settle();

		expect(mlAssistant.taskStarted).toBe(true);
		expect(prepend).toHaveBeenCalledWith(expect.objectContaining({ mlAssistant: true }));
		expect(appNavigation().goto).toHaveBeenCalledWith(
			"/conversation/created",
			expect.objectContaining({ state: expect.objectContaining({ pendingMessage: "hello" }) })
		);
	});

	it("uses the mode the server returned instead of the requested toggle", async () => {
		const { fetchSpy, prepend } = mountOnLink(component, url.split("?")[0] ?? "/", params);
		fetchSpy.mockResolvedValueOnce(createdResponse(false));
		mlAssistant.toggle(true);
		const composer = document.querySelector('[data-testid="composer"]') as HTMLTextAreaElement;
		composer.value = "hello";
		composer.dispatchEvent(new Event("input", { bubbles: true }));
		document.querySelector<HTMLButtonElement>('[data-testid="send-message"]')?.click();
		await settle();

		const [[, init]] = conversationPosts(fetchSpy);
		expect(JSON.parse(String(init?.body))).toMatchObject({ mlAssistant: true });
		expect(mlAssistant.enabled).toBe(false);
		expect(mlAssistant.taskStarted).toBe(false);
		expect(prepend).toHaveBeenCalledWith(expect.objectContaining({ mlAssistant: false }));
	});
});
