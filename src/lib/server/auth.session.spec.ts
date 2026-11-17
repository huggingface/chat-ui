import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenSet } from "openid-client";
import { collections, ready } from "$lib/server/database";
import { findUser, tokenSetToSessionOauth } from "$lib/server/auth";
import { createSecretBox } from "$lib/server/secretBox";
import { acquireLock, releaseLock } from "$lib/migrations/lock";
import { Semaphores } from "$lib/types/Semaphore";
import type { Session } from "$lib/types/Session";
import { cleanupTestData, createTestUser } from "$lib/server/api/__tests__/testHelpers";

vi.mock("$lib/server/config", async (importOriginal) => {
	const mod = await importOriginal<typeof import("$lib/server/config")>();
	return {
		...mod,
		config: new Proxy(mod.config, {
			get: (target, prop) =>
				prop === "SESSION_OAUTH_ENCRYPTION_KEY" ? "session-test-key" : Reflect.get(target, prop),
		}),
	};
});

const waiting = vi.hoisted(() => ({
	beforeLockCheck: undefined as undefined | (() => Promise<void>),
}));

vi.mock("$lib/migrations/lock", async (importOriginal) => {
	const mod = await importOriginal<typeof import("$lib/migrations/lock")>();
	return {
		...mod,
		isDBLocked: async (key: string) => {
			const hook = waiting.beforeLockCheck;
			waiting.beforeLockCheck = undefined;
			await hook?.();
			return mod.isDBLocked(key);
		},
	};
});

const url = new URL("http://localhost/");
const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

async function sessionWith(oauth: Session["oauth"]) {
	const { user, session } = await createTestUser();
	await collections.sessions.updateOne({ _id: session._id }, { $set: { oauth } });
	return { user, sessionId: session.sessionId };
}

beforeAll(async () => {
	await ready;
	// database.ts does not await this index and a second acquireLock succeeds without it
	await collections.semaphores.createIndex({ key: 1 }, { unique: true });
}, 30000);

describe("findUser with sign-in tokens", () => {
	beforeEach(async () => {
		waiting.beforeLockCheck = undefined;
		await cleanupTestData();
	}, 20000);

	it("stores tokens encrypted and hands them back decrypted", async () => {
		const oauth = tokenSetToSessionOauth({
			access_token: "hf_oauth_access",
			refresh_token: "hf_oauth_refresh",
			expires_at: inOneHour(),
		} as TokenSet);
		const { sessionId } = await sessionWith(oauth);

		const stored = await collections.sessions.findOne({ sessionId });
		expect(stored?.oauth?.token.value).toMatch(/^enc\.v1:/);
		expect(stored?.oauth?.refreshToken).toMatch(/^enc\.v1:/);
		expect(JSON.stringify(stored)).not.toContain("hf_oauth_");

		const result = await findUser(sessionId, undefined, url);
		expect(result.invalidateSession).toBe(false);
		expect(result.oauth?.token.value).toBe("hf_oauth_access");
		expect(result.oauth?.refreshToken).toBe("hf_oauth_refresh");
	});

	it("still reads a session stored before encryption", async () => {
		const { sessionId } = await sessionWith({
			token: { value: "hf_legacy", expiresAt: new Date(Date.now() + 3600_000) },
		});

		const result = await findUser(sessionId, undefined, url);
		expect(result.oauth?.token.value).toBe("hf_legacy");
	});

	it("signs the session out when its tokens were encrypted under another key", async () => {
		const otherKey = createSecretBox(() => "rotated-away-key", "");
		const { sessionId } = await sessionWith({
			token: {
				value: otherKey.encrypt("hf_old"),
				expiresAt: new Date(Date.now() + 3600_000),
			},
			refreshToken: otherKey.encrypt("hf_old_refresh"),
		});

		const result = await findUser(sessionId, undefined, url);
		expect(result).toMatchObject({ user: null, invalidateSession: true });
		expect(result.oauth).toBeUndefined();
	});

	describe("while another request is refreshing the token", () => {
		async function expiredSessionMidRefresh() {
			const stale = tokenSetToSessionOauth({
				access_token: "hf_stale",
				refresh_token: "hf_stale_refresh",
				expires_at: Math.floor(Date.now() / 1000) - 60,
			} as TokenSet);
			const { sessionId } = await sessionWith(stale);
			const lockKey = `${Semaphores.OAUTH_TOKEN_REFRESH}:${sessionId}`;
			const lockId = await acquireLock(lockKey);
			if (!lockId) throw new Error("lock not acquired");
			return {
				sessionId,
				release: async () => {
					await releaseLock(lockKey, lockId);
				},
			};
		}

		it("uses the token the other request stored", async () => {
			const { sessionId, release } = await expiredSessionMidRefresh();
			waiting.beforeLockCheck = async () => {
				await collections.sessions.updateOne(
					{ sessionId },
					{
						$set: {
							oauth: tokenSetToSessionOauth({
								access_token: "hf_fresh",
								refresh_token: "hf_fresh_refresh",
								expires_at: inOneHour(),
							} as TokenSet),
						},
					}
				);
				await release();
			};

			const result = await findUser(sessionId, undefined, url);
			expect(result.invalidateSession).toBe(false);
			expect(result.oauth?.token.value).toBe("hf_fresh");
		});

		it("signs the session out when the other request left the token unchanged", async () => {
			const { sessionId, release } = await expiredSessionMidRefresh();
			waiting.beforeLockCheck = release;

			expect(await findUser(sessionId, undefined, url)).toMatchObject({
				user: null,
				invalidateSession: true,
			});
		});
	});
});
