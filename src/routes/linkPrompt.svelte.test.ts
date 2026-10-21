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

const mcp = vi.hoisted(() => ({
	servers: [] as { id: string; url: string }[],
	selected: new Set<string>(),
}));
vi.mock("$lib/stores/mcpServers", async () => {
	const { readable, writable } = await import("svelte/store");
	const sameUrl = (a: string, b: string) => new URL(a).href === new URL(b).href;
	return {
		allMcpServers: writable(mcp.servers),
		selectedServerIds: writable(mcp.selected),
		enabledServersCount: readable(0),
		isSameServerUrl: sameUrl,
		addCustomServer: vi.fn(() => "added"),
		refreshMcpServers: vi.fn(async () => undefined),
		healthCheckServer: vi.fn(async () => undefined),
		setServerOAuth: vi.fn(),
		toggleServer: vi.fn(),
		reconcileOAuthConnections: vi.fn(async () => undefined),
		deleteCustomServer: vi.fn(),
		disconnectServerOAuth: vi.fn(async () => undefined),
	};
});

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

describe("mcp link on the home route", () => {
	const MCP_URL = "https://abc123.gradio.live/gradio_api/mcp/";
	const mcpLink = `/?mcp=${encodeURIComponent(MCP_URL)}&mcp_name=My%20App`;

	afterEach(() => {
		mcp.servers.length = 0;
		mcp.selected.clear();
	});

	it("opens the add form filled in, and strips the params from the URL", async () => {
		mountOnLink(HomePage as Component, mcpLink);
		await settle();

		expect(document.body.textContent).toContain("Add MCP server from link");
		expect(document.querySelector<HTMLInputElement>("#server-name")?.value).toBe("My App");
		expect(document.querySelector<HTMLInputElement>("#server-url")?.value).toBe(MCP_URL);
		const [url] = (appNavigation().replaceState.mock.lastCall ?? []) as unknown[];
		expect(new URL(String(url)).search).toBe("");
	});

	it("shows nothing for a server that is already enabled", async () => {
		mcp.servers.push({ id: "existing", url: MCP_URL });
		mcp.selected.add("existing");
		mountOnLink(HomePage as Component, mcpLink);
		await settle();

		expect(document.body.textContent).not.toContain("Add MCP server from link");
	});
});
