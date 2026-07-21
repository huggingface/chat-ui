/**
 * Covers the harness rather than `ChatMessage` itself: that a real component mounts, renders real
 * content, and observes per-test `$app/*` and context overrides.
 */

import { describe, expect, it } from "vitest";

import ChatMessage from "$lib/components/chat/ChatMessage.svelte";
import type { Message } from "$lib/types/Message";
import { appNavigation, renderWithApp } from "./renderWithApp";

const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const MODEL = "meta-llama/Llama-3.3-70B-Instruct";

function message(from: Message["from"], content: string, extra: Partial<Message> = {}): Message {
	return { id: MESSAGE_ID, from, content, ...extra };
}

/** An assistant message whose router metadata forces the `publicConfig.isHuggingChat` branch. */
function routedMessage(): Message {
	return message("assistant", "Answer.", {
		routerMetadata: { route: "default", model: MODEL },
	});
}

describe("renderWithApp", () => {
	it("mounts ChatMessage and renders assistant content", async () => {
		const screen = renderWithApp(ChatMessage, {
			message: message("assistant", "The capital of France is Paris."),
		});

		// Markdown upgrades off a worker pool, so this has to retry rather than read the DOM once.
		await expect.element(screen.getByText("The capital of France is Paris.")).toBeInTheDocument();

		expect(screen.baseElement.querySelector(`[data-message-id="${MESSAGE_ID}"]`)).not.toBeNull();
	});

	it("renders user content", async () => {
		const screen = renderWithApp(ChatMessage, {
			message: message("user", "What is the capital of France?"),
		});

		await expect.element(screen.getByText("What is the capital of France?")).toBeInTheDocument();
	});

	it("upgrades markdown from the escaped first paint", async () => {
		const screen = renderWithApp(ChatMessage, {
			message: message("assistant", "The capital of France is **Paris**."),
		});

		// Asserting on <strong> proves the worker upgrade landed, not the plaintext fallback.
		await expect.element(screen.getByText("Paris", { exact: true })).toBeInTheDocument();
		await expect
			.element(screen.getByText("Paris", { exact: true }))
			.toHaveProperty("tagName", "STRONG");
	});

	it("lets a test override page state for its own scenario", async () => {
		const screen = renderWithApp(
			ChatMessage,
			{
				message: message("user", "Here is an attachment", {
					// Renders the download-link branch. An <a href> is inert, where an <img src> would
					// issue a real request into the dev server and error at teardown.
					files: [
						{ type: "hash", name: "data.bin", value: "abc123", mime: "application/octet-stream" },
					],
				}),
			},
			{ page: { url: "/conversation/conv-42", params: { id: "conv-42" } } }
		);

		// Built from `page.url.pathname`, so this asserts the override reached a nested component.
		const link = screen.baseElement.querySelector<HTMLAnchorElement>('a[download="data.bin"]');
		expect(link?.getAttribute("href")).toBe("/conversation/conv-42/output/abc123");
	});

	it("supplies the publicConfig context ChatMessage dereferences", async () => {
		const screen = renderWithApp(ChatMessage, { message: routedMessage() });

		await expect.element(screen.getByText("default", { exact: true })).toBeInTheDocument();
		await expect
			.element(screen.getByText("Llama-3.3-70B-Instruct", { exact: true }))
			.toHaveProperty("tagName", "SPAN");
	});

	it("lets a test switch publicConfig to HuggingChat", async () => {
		const screen = renderWithApp(
			ChatMessage,
			{ message: routedMessage() },
			{ publicConfig: { PUBLIC_APP_ASSETS: "huggingchat" } }
		);

		await expect
			.element(screen.getByText("Llama-3.3-70B-Instruct", { exact: true }))
			.toHaveProperty("tagName", "A");
		expect(screen.baseElement.querySelector(`a[href="/chat/settings/${MODEL}"]`)).not.toBeNull();
	});

	it("exposes the $app/navigation spies without navigating", async () => {
		renderWithApp(ChatMessage, { message: message("assistant", "hello") });

		expect(appNavigation().goto).not.toHaveBeenCalled();
	});

	// This pair has to stay adjacent and in order: the first stubs a spy, the second proves the
	// per-test reset undid it. `mockClear()` would leave both the implementation and the queued
	// one-time value in place, silently leaking into every later test in the run.
	it("stubs a navigation spy", async () => {
		appNavigation().goto.mockImplementation(async () => "stubbed" as never);
		appNavigation().goto.mockResolvedValueOnce("queued" as never);

		await expect(appNavigation().goto()).resolves.toBe("queued");
	});

	it("restores stubbed navigation spies between tests", async () => {
		expect(appNavigation().goto).not.toHaveBeenCalled();
		await expect(appNavigation().goto()).resolves.toBeUndefined();
	});
});
