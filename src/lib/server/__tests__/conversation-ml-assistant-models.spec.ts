import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { FAKE_MODELS, mlSet } = vi.hoisted(() => ({
	FAKE_MODELS: ["zai-org/GLM-5.3-Flash", "moonshotai/Kimi-K3", "omni"].map((id) => ({
		id,
		name: id,
		unlisted: false,
		preprompt: "",
	})),
	mlSet: { ids: ["zai-org/GLM-5.3-Flash", "moonshotai/Kimi-K3"] },
}));

vi.mock("$lib/server/models", () => ({
	models: FAKE_MODELS,
	validateModel: () => z.string().refine((id) => FAKE_MODELS.some((m) => m.id === id)),
	validModelIdSchema: z.string(),
}));
vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/mlAssistantModels", () => ({
	mlAssistantModelIds: () => mlSet.ids,
	resolveMlAssistantModel: (requested: string | undefined) =>
		mlSet.ids.length === 0 ? undefined : (mlSet.ids.find((id) => id === requested) ?? mlSet.ids[0]),
	mlAssistantProviderFor: (_id: string, pref: string | undefined) => pref,
	mlAssistantModelEntry: () => undefined,
}));

import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestConversation,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";
import { POST as createConversation } from "../../../routes/conversation/+server";
import { PATCH as patchConversation } from "../../../routes/conversation/[id]/+server";
import { PATCH as patchConversationV2 } from "../../../routes/api/v2/conversations/[id]/+server";

beforeAll(async () => {
	await ready;
});

async function create(locals: App.Locals, body: Record<string, unknown>) {
	const response = await createConversation({
		locals,
		request: new Request("http://localhost/conversation", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	} as never);
	const { conversationId } = (await response.json()) as { conversationId: string };
	const { ObjectId } = await import("mongodb");
	return collections.conversations.findOne({ _id: new ObjectId(conversationId) });
}

describe.sequential("ML Intern conversations run on the fixed model set", () => {
	afterEach(async () => {
		vi.restoreAllMocks();
		mlSet.ids = ["zai-org/GLM-5.3-Flash", "moonshotai/Kimi-K3"];
		await cleanupTestData();
	});

	it("replaces an unlisted model (the router alias included) with the default", async () => {
		const { locals } = await createTestUser();
		const conv = await create(locals, { model: "omni", mlAssistant: true });
		expect(conv?.model).toBe("zai-org/GLM-5.3-Flash");
		expect(conv?.mlAssistant).toBe(true);
	});

	it("keeps a listed model", async () => {
		const { locals } = await createTestUser();
		const conv = await create(locals, { model: "moonshotai/Kimi-K3", mlAssistant: true });
		expect(conv?.model).toBe("moonshotai/Kimi-K3");
	});

	it("leaves ordinary conversations alone", async () => {
		const { locals } = await createTestUser();
		const conv = await create(locals, { model: "omni" });
		expect(conv?.model).toBe("omni");
		expect(conv?.mlAssistant).toBeUndefined();
	});

	it("refuses to start the mode with no models configured", async () => {
		mlSet.ids = [];
		const { locals } = await createTestUser();
		await expect(create(locals, { model: "omni", mlAssistant: true })).rejects.toMatchObject({
			status: 400,
		});
	});

	it("only switches a mode conversation to a listed model", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const patch = (model: string) =>
			patchConversation({
				locals,
				params: { id: conv._id.toString() },
				request: new Request("http://localhost/conversation", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ model }),
				}),
			} as never);

		await expect(patch("omni")).rejects.toMatchObject({ status: 400 });
		expect((await collections.conversations.findOne({ _id: conv._id }))?.model).toBe(conv.model);

		const ok = await patch("moonshotai/Kimi-K3");
		expect(ok.status).toBe(200);
		expect((await collections.conversations.findOne({ _id: conv._id }))?.model).toBe(
			"moonshotai/Kimi-K3"
		);
	});

	it("guards the v2 endpoint the same way", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		const patch = (model: string) =>
			patchConversationV2({
				locals,
				params: { id: conv._id.toString() },
				request: new Request("http://localhost/api/v2/conversations/x", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ model }),
				}),
			} as never);

		await expect(patch("omni")).rejects.toMatchObject({ status: 400 });
		expect((await collections.conversations.findOne({ _id: conv._id }))?.model).toBe(conv.model);

		const ok = await patch("moonshotai/Kimi-K3");
		expect(ok.status).toBe(200);
		expect((await collections.conversations.findOne({ _id: conv._id }))?.model).toBe(
			"moonshotai/Kimi-K3"
		);
	});

	it("lets an ordinary conversation switch to any model", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals);
		const ok = await patchConversation({
			locals,
			params: { id: conv._id.toString() },
			request: new Request("http://localhost/conversation", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model: "omni" }),
			}),
		} as never);
		expect(ok.status).toBe(200);
	});
});
