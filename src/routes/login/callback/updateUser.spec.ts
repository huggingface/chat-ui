import { assert, it, describe, afterEach, vi, expect } from "vitest";
import type { Cookies } from "@sveltejs/kit";
import { Database } from "$lib/server/database";
import { updateUser } from "./updateUser";
import { ObjectId } from "mongodb";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";
import { defaultModel } from "$lib/server/models";
import { findUser } from "$lib/server/auth";
import { defaultEmbeddingModel } from "$lib/server/embeddingModels";

const userData = {
	preferred_username: "new-username",
	name: "name",
	picture: "https://example.com/avatar.png",
	sub: "1234567890",
};
Object.freeze(userData);

const locals = {
	userId: "1234567890",
	sessionId: "1234567890",
};

// @ts-expect-error SvelteKit cookies dumb mock
const cookiesMock: Cookies = {
	set: vi.fn(),
};

const insertRandomUser = async () => {
	const res = await Database.getInstance().getCollections().users.insertOne({
		_id: new ObjectId(),
		createdAt: new Date(),
		updatedAt: new Date(),
		username: "base-username",
		name: userData.name,
		avatarUrl: userData.picture,
		hfUserId: userData.sub,
	});

	return res.insertedId;
};

const insertRandomConversations = async (count: number) => {
	const res = await Database.getInstance().getCollections().conversations.insertMany(
		new Array(count).fill(0).map(() => ({
			_id: new ObjectId(),
			title: "random title",
			messages: [],
			model: defaultModel.id,
			embeddingModel: defaultEmbeddingModel.id,
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionId: locals.sessionId,
		}))
	);

	return res.insertedIds;
};

describe("login", () => {
	it("should update user if existing", async () => {
		await insertRandomUser();

		await updateUser({ userData, locals, cookies: cookiesMock });

		const existingUser = await Database.getInstance().getCollections().users.findOne({ hfUserId: userData.sub });

		assert.equal(existingUser?.name, userData.name);

		expect(cookiesMock.set).toBeCalledTimes(1);
	});

	it("should migrate pre-existing conversations for new user", async () => {
		const insertedId = await insertRandomUser();

		await insertRandomConversations(2);

		await updateUser({ userData, locals, cookies: cookiesMock });

		const conversationCount = await Database.getInstance().getCollections().conversations.countDocuments({
			userId: insertedId,
			sessionId: { $exists: false },
		});

		assert.equal(conversationCount, 2);

		await Database.getInstance().getCollections().conversations.deleteMany({ userId: insertedId });
	});

	it("should create default settings for new user", async () => {
		await updateUser({ userData, locals, cookies: cookiesMock });

		const user = await findUser(locals.sessionId);

		assert.exists(user);

		const settings = await Database.getInstance().getCollections().settings.findOne({ userId: user?._id });

		expect(settings).toMatchObject({
			userId: user?._id,
			updatedAt: expect.any(Date),
			createdAt: expect.any(Date),
			ethicsModalAcceptedAt: expect.any(Date),
			...DEFAULT_SETTINGS,
		});

		await Database.getInstance().getCollections().settings.deleteOne({ userId: user?._id });
	});

	it("should migrate pre-existing settings for pre-existing user", async () => {
		const { insertedId } = await Database.getInstance().getCollections().settings.insertOne({
			sessionId: locals.sessionId,
			ethicsModalAcceptedAt: new Date(),
			updatedAt: new Date(),
			createdAt: new Date(),
			...DEFAULT_SETTINGS,
			shareConversationsWithModelAuthors: false,
		});

		await updateUser({ userData, locals, cookies: cookiesMock });

		const settings = await Database.getInstance().getCollections().settings.findOne({
			_id: insertedId,
			sessionId: { $exists: false },
		});

		assert.exists(settings);

		const user = await Database.getInstance().getCollections().users.findOne({ hfUserId: userData.sub });

		expect(settings).toMatchObject({
			userId: user?._id,
			updatedAt: expect.any(Date),
			createdAt: expect.any(Date),
			ethicsModalAcceptedAt: expect.any(Date),
			...DEFAULT_SETTINGS,
			shareConversationsWithModelAuthors: false,
		});

		await Database.getInstance().getCollections().settings.deleteOne({ userId: user?._id });
	});
});

afterEach(async () => {
	await Database.getInstance().getCollections().users.deleteMany({ hfUserId: userData.sub });
	await Database.getInstance().getCollections().sessions.deleteMany({});

	locals.userId = "1234567890";
	locals.sessionId = "1234567890";
	vi.clearAllMocks();
});
