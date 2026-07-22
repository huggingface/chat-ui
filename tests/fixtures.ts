/**
 * Playwright fixtures for the e2e harness — import `test` and `expect` from here rather than from
 * `playwright/test`.
 *
 * ```ts
 * test("streams a reply", async ({ page, mockOpenAI }) => {
 *   await mockOpenAI.setDefaultScenario("plainText");
 *   await page.goto("/");
 * });
 * ```
 *
 * This file also launches Mongo, because the app connects at boot and `webServer` is the only
 * hook that runs before it. `mongodb-memory-server` is imported dynamically so Playwright
 * workers, which import this module for its fixtures, never pay for it.
 */
import { test as base, expect, type APIRequestContext, type BrowserContext } from "playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { pathToFileURL } from "node:url";
import superjson from "superjson";
import { MOCK_OPENAI_PORT, type ScenarioSelector } from "./mock-openai.ts";
import { MOCK_MCP_PORT, type RecordedToolCall } from "./mock-mcp.ts";

export { expect };
export { SCENARIOS, type ScenarioName, type ScenarioScript } from "./mock-openai.ts";
export { MOCK_MCP_TOOLS } from "./mock-mcp.ts";

// Fixed rather than ephemeral so every process in the run agrees on them without passing state.
export const E2E_APP_PORT = Number(process.env.E2E_APP_PORT ?? 5199);
export const E2E_MONGO_PORT = Number(process.env.E2E_MONGO_PORT ?? 8790);
export const E2E_DB_NAME = process.env.E2E_DB_NAME ?? "chat-ui-e2e";

/**
 * Always an IP literal, never `localhost`: `ssrfSafeFetch` blocks `localhost` (it resolves to
 * `::1`) but allows literals, since undici only runs its `lookup` hook for hostnames needing DNS.
 */
export const E2E_APP_URL = `http://127.0.0.1:${E2E_APP_PORT}`;
export const E2E_MONGO_URL = `mongodb://127.0.0.1:${E2E_MONGO_PORT}`;
export const MOCK_OPENAI_ORIGIN = `http://127.0.0.1:${MOCK_OPENAI_PORT}`;
export const MOCK_OPENAI_BASE_URL = `${MOCK_OPENAI_ORIGIN}/v1`;
export const MOCK_MCP_ORIGIN = `http://127.0.0.1:${MOCK_MCP_PORT}`;
export const MOCK_MCP_URL = `${MOCK_MCP_ORIGIN}/mcp`;

/** Cookie the app stores the session secret in (`COOKIE_NAME` in .env). */
export const SESSION_COOKIE_NAME = process.env.COOKIE_NAME ?? "hf-chat";

/** Collections wiped between tests. */
const MUTABLE_COLLECTIONS = [
	"conversations",
	"conversations.stats",
	"sharedConversations",
	"abortedGenerations",
	"messageEvents",
	"reports",
	"settings",
	"sessions",
	"users",
];

// ── Test database ─────────────────────────────────────────────────────────────

export interface TestDatabaseHandle {
	uri: string;
	stop(): Promise<void>;
}

/** Started by `playwright.config.ts` as its first `webServer` entry, via the CLI block below. */
export async function startTestDatabase(): Promise<TestDatabaseHandle> {
	const { MongoMemoryServer } = await import("mongodb-memory-server");
	const mongod = await MongoMemoryServer.create({
		instance: { port: E2E_MONGO_PORT, dbName: E2E_DB_NAME },
		// Matches the version pinned in database.ts so CI reuses the same cached binary.
		binary: { version: "7.0.18" },
	});
	return {
		uri: mongod.getUri(),
		stop: async () => {
			await mongod.stop();
		},
	};
}

// ── Session helpers ───────────────────────────────────────────────────────────

/** The app keys session documents by the SHA-256 of the cookie value, so seeding must hash. */
export function sessionIdFromSecret(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}

export interface TestSession {
	/** Value stored in the browser cookie. */
	secret: string;
	/** Value written to `conversations.sessionId`. */
	sessionId: string;
}

/** Mint a session and install its cookie so the browser is already "logged in". */
export async function installSession(context: BrowserContext): Promise<TestSession> {
	const secret = randomUUID();
	await context.addCookies([
		{
			name: SESSION_COOKIE_NAME,
			value: secret,
			url: E2E_APP_URL,
			httpOnly: true,
			sameSite: "Lax",
		},
	]);
	return { secret, sessionId: sessionIdFromSecret(secret) };
}

/**
 * Suppresses the welcome modal, which marks `#app` as `inert` on a first visit — the page looks
 * fully rendered while silently swallowing every click and keystroke.
 */
export async function seedSettings(
	db: Db,
	sessionId: string,
	overrides: Record<string, unknown> = {}
): Promise<void> {
	const now = new Date();
	await db.collection("settings").insertOne({
		sessionId,
		welcomeModalSeenAt: now,
		shareConversationsWithModelAuthors: false,
		activeModel: "test-org/test-model",
		createdAt: now,
		updatedAt: now,
		...overrides,
	} as never);
}

// ── Conversation seeding ──────────────────────────────────────────────────────

export interface SeedMessage {
	from: "system" | "user" | "assistant";
	content: string;
	reasoning?: string;
	/** Extra fields merged onto the message — for legacy shapes. */
	extra?: Record<string, unknown>;
}

export interface SeedConversationInput {
	title?: string;
	model?: string;
	/** Defaults to the current test's session. */
	sessionId?: string;
	/** Built into a correct system -> user -> assistant tree. */
	messages?: SeedMessage[];
	/**
	 * Merged onto the document *after* the tree is built, so a legacy-shaped document can drop
	 * `rootMessageId`, use `string[]` files, or carry retired `MessageUpdate` variants.
	 */
	raw?: Record<string, unknown>;
}

/** Build a linear message tree with correct `ancestors` / `children` links. */
export function buildMessageTree(messages: SeedMessage[]): Array<Record<string, unknown>> {
	const now = new Date();
	const ids = messages.map(() => randomUUID());
	return messages.map((msg, i) => ({
		id: ids[i],
		from: msg.from,
		content: msg.content,
		...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
		createdAt: now,
		updatedAt: now,
		ancestors: ids.slice(0, i),
		children: i < ids.length - 1 ? [ids[i + 1]] : [],
		...msg.extra,
	}));
}

/**
 * Write a conversation straight into Mongo, bypassing the app entirely.
 * Returns its `_id`; navigate to `/conversation/${id}` to open it.
 */
export async function seedConversation(
	db: Db,
	defaultSessionId: string,
	input: SeedConversationInput = {}
): Promise<ObjectId> {
	const messages = buildMessageTree(
		input.messages ?? [
			{ from: "system", content: "" },
			{ from: "user", content: "seeded question" },
			{ from: "assistant", content: "seeded answer" },
		]
	);
	const now = new Date();
	const doc: Record<string, unknown> = {
		_id: new ObjectId(),
		sessionId: input.sessionId ?? defaultSessionId,
		model: input.model ?? "test-org/test-model",
		title: input.title ?? "Seeded conversation",
		rootMessageId: messages[0]?.id,
		messages,
		createdAt: now,
		updatedAt: now,
		...input.raw,
	};
	await db.collection("conversations").insertOne(doc as never);
	return doc._id as ObjectId;
}

// ── Mock control clients ──────────────────────────────────────────────────────

export interface MockOpenAIControl {
	/** Script the upstream for one conversation. Preferred — scoped, not global. */
	setScenario(conversationId: string, scenario: ScenarioSelector): Promise<void>;
	/** Script the upstream for every conversation without its own override. */
	setDefaultScenario(scenario: ScenarioSelector): Promise<void>;
	/** Clear all overrides and the request log. */
	reset(): Promise<void>;
	/** Every upstream request seen so far, newest last. */
	requests(): Promise<
		Array<{
			method: string;
			path: string;
			conversationId: string | null;
			stream: boolean;
			body: Record<string, unknown>;
			at: number;
		}>
	>;
}

function mockOpenAIControl(request: APIRequestContext): MockOpenAIControl {
	return {
		async setScenario(conversationId, scenario) {
			await request.post(`${MOCK_OPENAI_ORIGIN}/__control/scenario`, {
				data: { key: conversationId, scenario },
			});
		},
		async setDefaultScenario(scenario) {
			await request.post(`${MOCK_OPENAI_ORIGIN}/__control/scenario`, {
				data: { key: "default", scenario },
			});
		},
		async reset() {
			await request.post(`${MOCK_OPENAI_ORIGIN}/__control/reset`, { data: {} });
		},
		async requests() {
			const res = await request.get(`${MOCK_OPENAI_ORIGIN}/__control/requests`);
			return res.json();
		},
	};
}

export interface MockMcpControl {
	url: string;
	calls(): Promise<RecordedToolCall[]>;
	reset(): Promise<void>;
}

function mockMcpControl(request: APIRequestContext): MockMcpControl {
	return {
		url: MOCK_MCP_URL,
		async calls() {
			const res = await request.get(`${MOCK_MCP_ORIGIN}/__control/calls`);
			return res.json();
		},
		async reset() {
			await request.post(`${MOCK_MCP_ORIGIN}/__control/reset`, { data: {} });
		},
	};
}

// ── Direct HTTP helpers ───────────────────────────────────────────────────────

/** One decoded line of the `application/jsonl` stream. */
export type MessageUpdate = Record<string, unknown>;

export interface ApiHelpers {
	/** `POST /conversation` — returns the id plus the synthetic system root id. */
	createConversation(options?: {
		model?: string;
	}): Promise<{ conversationId: string; rootMessageId: string }>;
	/**
	 * `POST /conversation/:id` — sends a prompt and returns the decoded NDJSON updates. Multipart
	 * POSTs need an `Origin` or the CSRF guard rejects them, and `data.id` must carry the parent
	 * message id or `addChildren` throws; for the first turn that is the system root.
	 */
	sendMessage(options: {
		conversationId: string;
		parentId: string;
		content: string;
		mcpServers?: Array<{ name: string; url: string }>;
	}): Promise<MessageUpdate[]>;
}

function apiHelpers(request: APIRequestContext): ApiHelpers {
	return {
		async createConversation(options = {}) {
			const res = await request.post(`${E2E_APP_URL}/conversation`, {
				headers: { origin: E2E_APP_URL, "content-type": "application/json" },
				data: { model: options.model ?? "test-org/test-model" },
			});
			if (!res.ok()) {
				throw new Error(`POST /conversation failed: ${res.status()} ${await res.text()}`);
			}
			// Plain JSON, but the `conversation` field is a superjson string.
			const payload = (await res.json()) as { conversationId: string; conversation: string };
			if (!payload.conversationId) {
				throw new Error(`No conversationId in response: ${JSON.stringify(payload)}`);
			}
			const conversation = superjson.parse<{
				rootMessageId?: string;
				messages?: Array<{ id: string; from: string }>;
			}>(payload.conversation);
			const root =
				conversation.rootMessageId ?? conversation.messages?.find((m) => m.from === "system")?.id;
			if (!root) {
				throw new Error(`No root message id for conversation ${payload.conversationId}`);
			}
			return { conversationId: payload.conversationId, rootMessageId: root };
		},

		async sendMessage({ conversationId, parentId, content, mcpServers }) {
			const res = await request.post(`${E2E_APP_URL}/conversation/${conversationId}`, {
				// Without `origin` the CSRF guard rejects the multipart body.
				headers: { origin: E2E_APP_URL },
				multipart: {
					data: JSON.stringify({
						inputs: content,
						id: parentId, // parent message id — required
						is_retry: false,
						...(mcpServers
							? {
									selectedMcpServerNames: mcpServers.map((s) => s.name),
									selectedMcpServers: mcpServers.map((s) => ({
										name: s.name,
										url: s.url,
										headers: [],
									})),
								}
							: {}),
					}),
				},
			});
			if (!res.ok()) {
				throw new Error(`POST /conversation/:id failed: ${res.status()} ${await res.text()}`);
			}
			// Newline-delimited JSON (`application/jsonl`) — not SSE, not superjson.
			return (await res.text())
				.split("\n")
				.filter((line) => line.trim().length > 0)
				.map((line) => JSON.parse(line) as MessageUpdate);
		},
	};
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface Fixtures {
	db: Db;
	session: TestSession;
	mockOpenAI: MockOpenAIControl;
	mockMcp: MockMcpControl;
	seedConversation: (input?: SeedConversationInput) => Promise<ObjectId>;
	api: ApiHelpers;
}

interface WorkerFixtures {
	mongoClient: MongoClient;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
	// One connection per worker, reused across that worker's tests.
	mongoClient: [
		// Playwright derives dependencies from this destructuring pattern, so the braces are
		// load-bearing even when empty.
		// eslint-disable-next-line no-empty-pattern
		async ({}, use) => {
			const client = new MongoClient(E2E_MONGO_URL, { directConnection: true });
			await client.connect();
			await use(client);
			await client.close();
		},
		{ scope: "worker" },
	],

	db: async ({ mongoClient }, use) => {
		const db = mongoClient.db(E2E_DB_NAME);
		// Before rather than after, so a failed test leaves its data behind for inspection.
		await Promise.all(
			MUTABLE_COLLECTIONS.map((name) =>
				db
					.collection(name)
					.deleteMany({})
					.catch(() => undefined)
			)
		);
		await use(db);
	},

	session: async ({ context, db }, use) => {
		const session = await installSession(context);

		await seedSettings(db, session.sessionId);
		await use(session);
	},

	// Overridden purely to force `session` to run first.
	page: async ({ page, session }, use) => {
		void session;
		await use(page);
	},

	mockOpenAI: async ({ playwright }, use) => {
		const request = await playwright.request.newContext();
		const control = mockOpenAIControl(request);
		await control.reset();
		await use(control);
		await request.dispose();
	},

	mockMcp: async ({ playwright }, use) => {
		const request = await playwright.request.newContext();
		const control = mockMcpControl(request);
		await control.reset();
		await use(control);
		await request.dispose();
	},

	seedConversation: async ({ db, session }, use) => {
		await use((input?: SeedConversationInput) => seedConversation(db, session.sessionId, input));
	},

	api: async ({ page }, use) => {
		// Bound to the page so the session cookie rides along.
		await use(apiHelpers(page.request));
	},
});

// CLI mode, started by playwright.config.ts as the first `webServer` entry.
const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	startTestDatabase().then((handle) => {
		console.log(`[e2e-db] listening on ${handle.uri}`);
	});
}
