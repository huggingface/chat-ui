import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";

import { collections, ready } from "$lib/server/database";
import { markGenerationInterrupted } from "../finalize";

beforeAll(async () => {
	await ready;
});

interface SeedOpts {
	status: "running" | "completed" | "error";
}

async function seed({ status }: SeedOpts) {
	const now = new Date();
	const conversationId = new ObjectId();
	const messageId = randomUUID();
	const generationId = randomUUID();

	await collections.conversations.insertOne({
		_id: conversationId,
		messages: [{ id: messageId, from: "assistant", content: "partial", updates: [] }],
		createdAt: now,
		updatedAt: now,
	} as never);

	await collections.generations.insertOne({
		_id: new ObjectId(),
		generationId,
		conversationId,
		messageId,
		status,
		seq: 3,
		startedAt: now,
		lastHeartbeatAt: now,
		createdAt: now,
		updatedAt: now,
		...(status === "running" ? {} : { endedAt: now }),
	} as never);

	return { conversationId, messageId, generationId };
}

async function messageInterrupted(conversationId: ObjectId, messageId: string): Promise<boolean> {
	const conv = await collections.conversations.findOne({ _id: conversationId });
	const msg = (conv?.messages ?? []).find((m) => m.id === messageId);
	return msg?.interrupted === true;
}

describe.sequential("markGenerationInterrupted", () => {
	afterEach(async () => {
		await Promise.all([
			collections.conversations.deleteMany({}),
			collections.generations.deleteMany({}),
			collections.mcpElicitations.deleteMany({}),
			collections.mlAgentRuns.deleteMany({}),
		]);
	});

	const prompt = async ({
		generationId,
		conversationId,
		messageId,
		durable,
	}: {
		generationId: string;
		conversationId: ObjectId;
		messageId: string;
		durable: boolean;
	}) => {
		const elicitationId = randomUUID();
		const now = new Date();
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			elicitationId,
			conversationId,
			generationId,
			status: "pending",
			request: { elicitationId, server: "Test", mode: "form", message: "?", fields: [] },
			...(durable
				? { pending: { kind: "ask", messageId, toolCallId: "call-1", toolUuid: "tool-1" } }
				: { expiresAt: new Date(now.getTime() + 60_000) }),
			createdAt: now,
			updatedAt: now,
		});
		return elicitationId;
	};

	it("marks the message when it wins the claim on a running run", async () => {
		const { conversationId, messageId, generationId } = await seed({ status: "running" });

		await markGenerationInterrupted(generationId, { conversationId, messageId });

		const gen = await collections.generations.findOne({ generationId });
		expect(gen?.status).toBe("interrupted");
		expect(await messageInterrupted(conversationId, messageId)).toBe(true);
	});

	// The race the reaper's own status filter cannot prevent: it selects a running run, but
	// the owner pod finishes it before this update lands. The claim must fail closed.
	it("leaves a message untouched when the run already completed", async () => {
		const { conversationId, messageId, generationId } = await seed({ status: "completed" });

		await markGenerationInterrupted(generationId, { conversationId, messageId });

		const gen = await collections.generations.findOne({ generationId });
		expect(gen?.status, "a completed run must not be flipped to interrupted").toBe("completed");
		expect(
			await messageInterrupted(conversationId, messageId),
			"a finished answer must not be flagged stopped"
		).toBe(false);
	});

	it("leaves a message untouched when the run already errored", async () => {
		const { conversationId, messageId, generationId } = await seed({ status: "error" });

		await markGenerationInterrupted(generationId, { conversationId, messageId });

		const gen = await collections.generations.findOne({ generationId });
		expect(gen?.status).toBe("error");
		expect(await messageInterrupted(conversationId, messageId)).toBe(false);
	});

	it("closes the prompts the dead run was polling, and only those", async () => {
		const { conversationId, messageId, generationId } = await seed({ status: "running" });
		const blocking = await prompt({ generationId, conversationId, messageId, durable: false });
		// Nothing polls a durable prompt: its answer continues the turn whenever it comes, and
		// closing it here would turn that answer into a refusal.
		const durable = await prompt({ generationId, conversationId, messageId, durable: true });

		await markGenerationInterrupted(generationId, { conversationId, messageId });

		expect(await collections.mcpElicitations.findOne({ elicitationId: blocking })).toMatchObject({
			status: "resolved",
			action: "cancel",
			resolution: "aborted",
		});
		expect(await collections.mcpElicitations.findOne({ elicitationId: durable })).toMatchObject({
			status: "pending",
		});
	});

	it("interrupts the sub-agent runs the dead run left running, and only those", async () => {
		const { conversationId, messageId, generationId } = await seed({ status: "running" });
		const run = (
			task: string,
			over: { status?: "running" | "completed"; generationId?: string; conversationId?: ObjectId }
		) => ({
			_id: new ObjectId(),
			conversationId: over.conversationId ?? conversationId,
			label: "research",
			displayName: "Research",
			task,
			parent: { tool: "research", toolUuid: task, generationId: over.generationId ?? generationId },
			status: over.status ?? ("running" as const),
			startedAt: new Date(),
			iterations: 1,
			calls: [],
			callCount: 0,
			sourceCount: 0,
		});
		await collections.mlAgentRuns.insertMany([
			run("live", {}),
			run("done", { status: "completed" }),
			run("other-turn", { generationId: randomUUID() }),
			run("other-chat", { conversationId: new ObjectId() }),
		]);

		await markGenerationInterrupted(generationId, { conversationId, messageId });

		const byTask = Object.fromEntries(
			(await collections.mlAgentRuns.find({}).toArray()).map((r) => [r.task, r])
		);
		expect(byTask.live.status).toBe("interrupted");
		expect(byTask.live.endedAt).toBeInstanceOf(Date);
		expect(byTask.done.status).toBe("completed");
		expect(byTask["other-turn"].status).toBe("running");
		expect(byTask["other-chat"].status).toBe("running");
	});
});
