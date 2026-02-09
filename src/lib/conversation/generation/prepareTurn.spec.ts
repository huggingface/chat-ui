import { describe, expect, it } from "vitest";
import type { Message } from "$lib/types/Message";
import { prepareTurn } from "./prepareTurn";

function createUserMessage(params: { prompt: string; files?: Message["files"] }) {
	return {
		from: "user" as const,
		content: params.prompt,
		files: params.files,
	};
}

function createAssistantMessage() {
	return {
		from: "assistant" as const,
		content: "",
	};
}

describe("prepareTurn", () => {
	it("creates a normal user+assistant turn", () => {
		const tree = {
			messages: [] as Message[],
			rootMessageId: undefined as Message["id"] | undefined,
		};

		const preparedTurn = prepareTurn({
			tree,
			prompt: "Hello",
			createUserMessage,
			createAssistantMessage,
		});

		expect(tree.messages).toHaveLength(2);
		expect(tree.rootMessageId).toBe(preparedTurn.promptAnchorId);
		expect(tree.messages[0].from).toBe("user");
		expect(tree.messages[0].content).toBe("Hello");
		expect(tree.messages[1].from).toBe("assistant");
		expect(tree.messages[1].ancestors).toEqual([preparedTurn.promptAnchorId]);
		expect(preparedTurn.excludeAnchorFromPrompt).toBe(false);
	});

	it("defaults to an empty prompt for normal sends", () => {
		const tree = {
			messages: [] as Message[],
			rootMessageId: undefined as Message["id"] | undefined,
		};

		prepareTurn({
			tree,
			createUserMessage,
			createAssistantMessage,
		});

		expect(tree.messages[0].content).toBe("");
	});

	it("creates an edited user retry branch and a new assistant child", () => {
		const tree = {
			rootMessageId: "root",
			messages: [
				{
					id: "root",
					from: "system",
					content: "sys",
					ancestors: [],
					children: ["user-1"],
				},
				{
					id: "user-1",
					from: "user",
					content: "old",
					files: [{ type: "hash", name: "old.txt", value: "sha-old", mime: "text/plain" }],
					ancestors: ["root"],
					children: ["assistant-1"],
				},
				{
					id: "assistant-1",
					from: "assistant",
					content: "old answer",
					ancestors: ["root", "user-1"],
					children: [],
				},
			] satisfies Message[],
		};

		const preparedTurn = prepareTurn({
			tree,
			isRetry: true,
			messageId: "user-1",
			prompt: "edited",
			files: [{ type: "hash", name: "new.txt", value: "sha-new", mime: "text/plain" }],
			createUserMessage,
			createAssistantMessage,
		});

		const newUserMessage = tree.messages.find(
			(message) => message.id === preparedTurn.promptAnchorId
		);
		const newAssistantMessage = tree.messages.find(
			(message) => message.id === preparedTurn.assistantMessageId
		);

		expect(preparedTurn.excludeAnchorFromPrompt).toBe(false);
		expect(newUserMessage?.from).toBe("user");
		expect(newUserMessage?.content).toBe("edited");
		expect(newUserMessage?.files?.[0]?.name).toBe("new.txt");
		expect(newUserMessage?.ancestors).toEqual(["root"]);
		expect(newAssistantMessage?.from).toBe("assistant");
		expect(newAssistantMessage?.ancestors).toEqual(["root", preparedTurn.promptAnchorId]);
	});

	it("creates a sibling assistant for assistant retry and excludes anchor from prompt", () => {
		const tree = {
			rootMessageId: "root",
			messages: [
				{ id: "root", from: "system", content: "sys", ancestors: [], children: ["user-1"] },
				{
					id: "user-1",
					from: "user",
					content: "question",
					ancestors: ["root"],
					children: ["assistant-1"],
				},
				{
					id: "assistant-1",
					from: "assistant",
					content: "answer",
					ancestors: ["root", "user-1"],
					children: [],
				},
			] satisfies Message[],
		};

		const preparedTurn = prepareTurn({
			tree,
			isRetry: true,
			messageId: "assistant-1",
			createUserMessage,
			createAssistantMessage,
		});

		const newAssistant = tree.messages.find(
			(message) => message.id === preparedTurn.assistantMessageId
		);

		expect(preparedTurn.promptAnchorId).toBe("assistant-1");
		expect(preparedTurn.excludeAnchorFromPrompt).toBe(true);
		expect(newAssistant?.from).toBe("assistant");
		expect(newAssistant?.ancestors).toEqual(["root", "user-1"]);
	});

	it("throws when retry target does not exist", () => {
		const tree = {
			rootMessageId: "root",
			messages: [
				{ id: "root", from: "system", content: "sys", ancestors: [], children: [] },
			] satisfies Message[],
		};

		expect(() =>
			prepareTurn({
				tree,
				isRetry: true,
				messageId: "missing",
				prompt: "retry",
				createUserMessage,
				createAssistantMessage,
			})
		).toThrowError("Message not found");
	});

	it("throws when retrying a user message without a replacement prompt", () => {
		const tree = {
			rootMessageId: "root",
			messages: [
				{ id: "root", from: "system", content: "sys", ancestors: [], children: ["user-1"] },
				{
					id: "user-1",
					from: "user",
					content: "old",
					ancestors: ["root"],
					children: [],
				},
			] satisfies Message[],
		};

		expect(() =>
			prepareTurn({
				tree,
				isRetry: true,
				messageId: "user-1",
				createUserMessage,
				createAssistantMessage,
			})
		).toThrowError("Retrying a user message requires a new prompt");
	});

	it("throws for retry on legacy conversation and root message", () => {
		const legacyTree = {
			messages: [{ id: "user-1", from: "user", content: "legacy" }] satisfies Message[],
			rootMessageId: undefined as Message["id"] | undefined,
		};

		expect(() =>
			prepareTurn({
				tree: legacyTree,
				isRetry: true,
				messageId: "user-1",
				prompt: "edited",
				createUserMessage,
				createAssistantMessage,
			})
		).toThrowError("Cannot add a sibling to a legacy conversation");

		const rootedTree = {
			rootMessageId: "root",
			messages: [
				{ id: "root", from: "user", content: "root", ancestors: [], children: [] },
			] satisfies Message[],
		};

		expect(() =>
			prepareTurn({
				tree: rootedTree,
				isRetry: true,
				messageId: "root",
				prompt: "edited",
				createUserMessage,
				createAssistantMessage,
			})
		).toThrowError("The sibling message is the root message");
	});

	it("falls back to normal turn creation when retry target is not user/assistant", () => {
		const tree = {
			rootMessageId: "root",
			messages: [
				{ id: "root", from: "system", content: "sys", ancestors: [], children: [] },
			] satisfies Message[],
		};

		const preparedTurn = prepareTurn({
			tree,
			isRetry: true,
			messageId: "root",
			prompt: "new user turn",
			createUserMessage,
			createAssistantMessage,
		});

		expect(tree.messages).toHaveLength(3);
		expect(preparedTurn.excludeAnchorFromPrompt).toBe(false);
		expect(tree.messages.at(-2)?.from).toBe("user");
		expect(tree.messages.at(-1)?.from).toBe("assistant");
	});
});
