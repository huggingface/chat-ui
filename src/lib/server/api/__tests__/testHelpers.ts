import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { config } from "$lib/server/config";
import { sha256 } from "$lib/utils/sha256";
import type { User } from "$lib/types/User";
import type { Session } from "$lib/types/Session";
import type { Conversation } from "$lib/types/Conversation";

export function createTestLocals(overrides?: Partial<App.Locals>): App.Locals {
	return {
		sessionId: "test-session-id",
		isAdmin: false,
		user: undefined,
		token: undefined,
		...overrides,
	};
}

export interface TestUser {
	user: User;
	session: Session;
	locals: App.Locals;
	/**
	 * The raw session secret. `authenticateRequest()` reads this from the cookie and looks
	 * the session up by its sha256, so it is *not* `session.sessionId`.
	 */
	secretSessionId: string;
	/** Ready-made `Cookie` header value, for driving real authentication. */
	cookie: string;
}

export async function createTestUser(): Promise<TestUser> {
	await ready;

	const userId = new ObjectId();
	const secretSessionId = crypto.randomUUID();
	const sessionId = await sha256(secretSessionId);

	const user: User = {
		_id: userId,
		createdAt: new Date(),
		updatedAt: new Date(),
		username: `user-${userId.toString().slice(0, 8)}`,
		name: "Test User",
		avatarUrl: "https://example.com/avatar.png",
		hfUserId: `hf-${userId.toString()}`,
	};

	const session: Session = {
		_id: new ObjectId(),
		createdAt: new Date(),
		updatedAt: new Date(),
		userId,
		sessionId,
		expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
	};

	await collections.users.insertOne(user);
	await collections.sessions.insertOne(session);

	return {
		user,
		session,
		locals: {
			user,
			sessionId,
			isAdmin: false,
			token: undefined,
		},
		secretSessionId,
		cookie: `${config.COOKIE_NAME}=${secretSessionId}`,
	};
}

export async function createTestConversation(
	locals: App.Locals,
	overrides?: Partial<Conversation>
): Promise<Conversation> {
	await ready;

	const conv: Conversation = {
		_id: new ObjectId(),
		title: "Test Conversation",
		model: "test-model",
		messages: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		...(locals.user ? { userId: locals.user._id } : { sessionId: locals.sessionId }),
		...overrides,
	};

	await collections.conversations.insertOne(conv);
	return conv;
}

/** Wipes every collection the app writes to. Anything added to `getCollections()` belongs here. */
export async function cleanupTestData() {
	await ready;

	await Promise.all([
		collections.conversations.deleteMany({}),
		collections.conversationStats.deleteMany({}),
		collections.abortedGenerations.deleteMany({}),
		collections.users.deleteMany({}),
		collections.sessions.deleteMany({}),
		collections.settings.deleteMany({}),
		collections.sharedConversations.deleteMany({}),
		collections.reports.deleteMany({}),
		collections.assistants.deleteMany({}),
		collections.messageEvents.deleteMany({}),
		collections.semaphores.deleteMany({}),
		collections.migrationResults.deleteMany({}),
		collections.tokenCaches.deleteMany({}),
		collections.tools.deleteMany({}),
		cleanupGridFS(),
	]);
}

/**
 * Deletes files rather than calling `bucket.drop()`, which would take the bucket's indexes
 * with it and rejects outright when the namespace was never created.
 */
async function cleanupGridFS() {
	const files = await collections.bucket.find({}).toArray();
	await Promise.all(files.map((file) => collections.bucket.delete(file._id)));
}
