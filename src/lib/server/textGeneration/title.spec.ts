import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { MessageUpdateType } from "$lib/types/MessageUpdate";
import type { Conversation } from "$lib/types/Conversation";

const mocks = vi.hoisted(() => ({
	generateFromDefaultEndpoint: vi.fn(),
	config: { LLM_SUMMARIZATION: "true", TASK_MODEL: "" } as Record<string, string>,
}));

vi.mock("$lib/server/config", () => ({ config: mocks.config }));
vi.mock("$lib/server/logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock("$lib/server/generateFromDefaultEndpoint", () => ({
	generateFromDefaultEndpoint: mocks.generateFromDefaultEndpoint,
}));

const { generateTitleForConversation } = await import("./title");

/** Endpoint stub: yields nothing, returns `text` as the generated title. */
function endpointReturning(text: string) {
	// eslint-disable-next-line require-yield
	return async function* () {
		return text;
	};
}

function newConversation(content: string): Conversation {
	return {
		_id: new ObjectId(),
		title: "New Chat",
		model: "test-model",
		messages: [{ id: "1" as Conversation["messages"][number]["id"], from: "user", content }],
	} as unknown as Conversation;
}

async function titleFor(generated: string, userMessage = "how do I reverse a string in Python?") {
	mocks.generateFromDefaultEndpoint.mockImplementation(endpointReturning(generated));
	const updates = [];
	for await (const u of generateTitleForConversation(newConversation(userMessage), undefined)) {
		updates.push(u);
	}
	const titleUpdate = updates.find((u) => u.type === MessageUpdateType.Title);
	return titleUpdate && "title" in titleUpdate ? titleUpdate.title : undefined;
}

describe("generateTitleForConversation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.config.LLM_SUMMARIZATION = "true";
	});

	it("uses the model's title when it returns plain text", async () => {
		expect(await titleFor("Python string reversal")).toBe("Python string reversal");
	});

	it("drops a complete reasoning block and keeps the title after it", async () => {
		expect(await titleFor("<think>The user wants Python help.</think>Python string reversal")).toBe(
			"Python string reversal"
		);
	});

	it("does not use truncated reasoning as the title when the budget is spent thinking", async () => {
		// max_tokens is 24, so a reasoning model can burn the whole budget before
		// emitting any title, leaving an unterminated <think> block and no content.
		const title = await titleFor("<think>We need to produce a title. The user is asking");
		expect(title).not.toContain("We need to produce a title");
		expect(title).toBe("how do I reverse a");
	});
});

describe("Slack conversation titles", () => {
	const request = "find small OCR models on the Hub";
	function slackConversation(title = "[Slack] New Chat") {
		const conv = newConversation(
			`The invoking Slack user is U123. Reply in this thread.\n\n<slack_thread_context>\n[]\n</slack_thread_context>\n\nInvoking user's request:\n${request}`
		);
		conv.title = title;
		conv.managedBy = { kind: "slack", continueUrl: "https://app.slack.com/client/T/C" };
		return conv;
	}
	async function updatesFor(conv: Conversation, locals?: App.Locals) {
		const updates = [];
		for await (const update of generateTitleForConversation(conv, locals)) updates.push(update);
		return updates;
	}
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.config.LLM_SUMMARIZATION = "true";
		mocks.config.TASK_MODEL = "";
		mocks.generateFromDefaultEndpoint.mockImplementation(endpointReturning("Small OCR models"));
	});
	it("uses regular title generation on the request with the owner's credentials", async () => {
		const locals = {} as App.Locals;
		mocks.config.TASK_MODEL = "title-model";
		expect(await updatesFor(slackConversation(), locals)).toEqual([
			{ type: MessageUpdateType.Title, title: "[Slack] Small OCR models" },
		]);
		expect(mocks.generateFromDefaultEndpoint).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [{ from: "user", content: `User message: "${request}"` }],
				modelId: "title-model",
				locals,
			})
		);
	});
	it("renames legacy placeholders on the next turn", async () => {
		expect(await updatesFor(slackConversation("Slack · C0C8Q8HHA6M · 2026-10-15T19:40"))).toEqual([
			{ type: MessageUpdateType.Title, title: "[Slack] Small OCR models" },
		]);
	});
	it("keeps existing summaries and user-edited titles", async () => {
		for (const title of ["[Slack] Small OCR models", "My custom title"]) {
			expect(await updatesFor(slackConversation(title))).toEqual([]);
		}
		expect(mocks.generateFromDefaultEndpoint).not.toHaveBeenCalled();
	});
	it("does not migrate matching titles on regular conversations", async () => {
		const conv = slackConversation("Slack · C123 · 2026-10-15T19:40");
		delete conv.managedBy;
		expect(await updatesFor(conv)).toEqual([]);
	});
	it("uses the regular fallback on the request when summarization is disabled", async () => {
		mocks.config.LLM_SUMMARIZATION = "false";
		expect(await updatesFor(slackConversation())).toEqual([
			{ type: MessageUpdateType.Title, title: "[Slack] find small OCR models on" },
		]);
		expect(mocks.generateFromDefaultEndpoint).not.toHaveBeenCalled();
	});
});
