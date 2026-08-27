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
