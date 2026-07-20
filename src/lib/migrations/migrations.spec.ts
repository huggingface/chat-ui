import { afterEach, assert, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { migrations } from "./routines";
import { acquireLock, isDBLocked, refreshLock, releaseLock } from "./lock";
import { Semaphores } from "$lib/types/Semaphore";
import { collections, ready } from "$lib/server/database";

describe(
	"migrations",
	{
		retry: 3,
	},
	() => {
		beforeAll(async () => {
			await ready;
			try {
				await collections.semaphores.createIndex({ key: 1 }, { unique: true });
			} catch (e) {
				// Index might already exist, ignore error
			}
		}, 20000);

		it("should not have duplicates guid", async () => {
			const guids = migrations.map((m) => m._id.toString());
			const uniqueGuids = [...new Set(guids)];
			expect(uniqueGuids.length).toBe(guids.length);
		});

		it("should acquire only one lock on DB", async () => {
			const results = await Promise.all(
				new Array(1000).fill(0).map(() => acquireLock(Semaphores.TEST_MIGRATION))
			);
			const locks = results.filter((r) => r);

			const semaphores = await collections.semaphores.find({}).toArray();

			expect(locks.length).toBe(1);
			expect(semaphores).toBeDefined();
			expect(semaphores.length).toBe(1);
			expect(semaphores?.[0].key).toBe(Semaphores.TEST_MIGRATION);
		});

		it("should read the lock correctly", async () => {
			const lockId = await acquireLock(Semaphores.TEST_MIGRATION);
			assert(lockId);
			expect(await isDBLocked(Semaphores.TEST_MIGRATION)).toBe(true);
			expect(!!(await acquireLock(Semaphores.TEST_MIGRATION))).toBe(false);
			await releaseLock(Semaphores.TEST_MIGRATION, lockId);
			expect(await isDBLocked(Semaphores.TEST_MIGRATION)).toBe(false);
		});

		it("should refresh the lock", async () => {
			const lockId = await acquireLock(Semaphores.TEST_MIGRATION);
			assert(lockId);

			const before = await collections.semaphores.findOne({ _id: lockId });
			assert(before);

			// `updatedAt`/`deleteAt` are millisecond-precision, so guarantee a distinct tick.
			await new Promise((r) => setTimeout(r, 5));

			expect(await refreshLock(Semaphores.TEST_MIGRATION, lockId)).toBe(true);

			const after = await collections.semaphores.findOne({ _id: lockId });
			assert(after);

			// Compare timestamps, not object identity. Two Date instances read from separate
			// queries are never `toBe`-equal, so the previous `.not.toBe()` form passed
			// unconditionally and never exercised refreshLock at all.
			expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
			// The whole point of refreshing is extending the TTL.
			expect(after.deleteAt.getTime()).toBeGreaterThan(before.deleteAt.getTime());
		});

		it("should not refresh a lock held by someone else", async () => {
			const lockId = await acquireLock(Semaphores.TEST_MIGRATION);
			assert(lockId);

			const before = await collections.semaphores.findOne({ _id: lockId });
			assert(before);

			expect(await refreshLock(Semaphores.TEST_MIGRATION, new ObjectId())).toBe(false);

			const after = await collections.semaphores.findOne({ _id: lockId });
			assert(after);
			expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
		});

		afterEach(async () => {
			await collections.semaphores.deleteMany({});
			await collections.migrationResults.deleteMany({});
		});
	}
);
