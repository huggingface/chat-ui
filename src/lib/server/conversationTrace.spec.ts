import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { writeMlFileVersion } from "$lib/server/mlFiles/store";
import type { MlAgentRun } from "$lib/types/MlAgentRun";
import { buildConversationTrace, slugify, traceFilename } from "./conversationTrace";

beforeAll(async () => {
	await ready;
});

afterEach(async () => {
	await Promise.all([
		collections.mlFiles.deleteMany({}),
		collections.mlAgentRuns.deleteMany({}),
		collections.nestedAgentCalls.deleteMany({}),
	]);
});

const CONVERSATION = {
	title: "Fine-tune SmolLM on my data",
	model: "zai-org/GLM-5.3",
	createdAt: new Date("2026-09-29T10:00:00Z"),
	updatedAt: new Date("2026-09-29T11:00:00Z"),
	messages: [],
};

function agentRun(conversationId: ObjectId, label: string): MlAgentRun {
	return {
		_id: new ObjectId(),
		conversationId,
		label,
		displayName: label,
		task: "look around",
		parent: { tool: label, toolUuid: "u1" },
		status: "completed",
		startedAt: new Date(),
		iterations: 1,
		calls: [{ tool: "hf_fs", args: "ls", status: "success" }],
		callCount: 1,
		sourceCount: 0,
		summary: "done",
	};
}

describe("traceFilename", () => {
	it("joins the id and the slugged title", () => {
		expect(traceFilename("66f9", "Fine-tune SmolLM: réglage fin!")).toBe(
			"66f9-fine-tune-smollm-reglage-fin.json"
		);
	});

	it("falls back to the id when the title leaves nothing", () => {
		expect(traceFilename("66f9", "🚀 !!")).toBe("66f9.json");
	});

	it("keeps a long title short without a trailing dash", () => {
		const slug = slugify(`${"a".repeat(59)} b`);
		expect(slug).toBe("a".repeat(59));
	});
});

describe("buildConversationTrace", () => {
	it("keeps what the pane projects away, and only this conversation's rows", async () => {
		const conversationId = new ObjectId();
		const other = new ObjectId();
		await collections.mlAgentRuns.insertMany([
			agentRun(conversationId, "research"),
			agentRun(conversationId, "sandbox"),
			agentRun(other, "research"),
		]);
		const run = agentRun(conversationId, "research");
		await collections.nestedAgentCalls.insertMany(
			[conversationId, conversationId, other].map((owner, iteration) => ({
				_id: new ObjectId(),
				conversationId: owner,
				agentRunId: run._id.toString(),
				label: "research",
				iteration,
				toolName: "hf_fs",
				arguments: `ls ${iteration}`,
				repeatCount: 1,
				status: "success" as const,
				createdAt: new Date(Date.now() + iteration),
			}))
		);
		await writeMlFileVersion({ conversationId, name: "train.py", content: "v1", origin: "write" });
		await writeMlFileVersion({ conversationId, name: "train.py", content: "v2", origin: "edit" });

		const trace = await buildConversationTrace(conversationId, CONVERSATION);

		expect(trace.conversation).toMatchObject({
			id: conversationId.toString(),
			title: CONVERSATION.title,
		});
		expect(trace.agentRuns.map((run) => run.label)).toEqual(["research", "sandbox"]);
		expect(trace.agentRuns[0]).toMatchObject({ summary: "done", calls: [{ tool: "hf_fs" }] });
		expect(trace.agentRuns[0]).not.toHaveProperty("conversationId");
		expect(trace.agentCalls.map((call) => call.arguments)).toEqual(["ls 0", "ls 1"]);
		expect(trace.files.map((file) => [file.version, file.content])).toEqual([
			[1, "v1"],
			[2, "v2"],
		]);

		const parsed = JSON.parse(JSON.stringify(trace));
		expect(parsed.agentRuns[0].id).toMatch(/^[0-9a-f]{24}$/);
	});
});
