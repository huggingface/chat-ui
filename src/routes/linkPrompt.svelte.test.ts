import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { writable } from "svelte/store";
import type { Component } from "svelte";
import { appNavigation, renderWithApp } from "$lib/components/__tests__/renderWithApp";
import { setPage } from "$lib/components/__tests__/appMocks";
import { loadAttachmentsFromUrls } from "$lib/utils/loadAttachmentsFromUrls";
import HomePage from "./+page.svelte";
import ModelPage from "./models/[...model]/+page.svelte";

vi.mock("$lib/components/chat/ChatWindow.svelte", async () => ({
	default: (await import("$lib/components/__tests__/ChatWindowStub.svelte")).default,
}));
vi.mock("$lib/utils/loadAttachmentsFromUrls", () => ({ loadAttachmentsFromUrls: vi.fn() }));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

type Loaded = Awaited<ReturnType<typeof loadAttachmentsFromUrls>>;

const LINK = "?q=hello&attachments=https://a.example/file.txt";

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
	const fetchSpy = vi.fn(
		async () => new Response(JSON.stringify({ conversationId: "created" }), { status: 200 })
	);
	vi.stubGlobal("fetch", fetchSpy);

	const settings = Object.assign(
		writable({ activeModel: "test", customPrompts: {}, welcomeModalSeen: true }),
		{ instantSet: vi.fn(async () => undefined) }
	);
	const context = new Map<unknown, unknown>([
		["settings", settings],
		["conversationsStore", { prepend: vi.fn() }],
	]);
	const screen = renderWithApp(
		component,
		{ data: { models: [{ id: "test" }], oldModels: [], mlAssistantModels: [] } } as never,
		{ context, page: { url, params, data: { loginEnabled: false } } }
	);
	return {
		screen,
		fetchSpy,
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
});
