import { afterEach, describe, expect, it } from "vitest";
import { migrations } from "./routines";
import {
	acquireLock,
	createAndAcquireLock,
	discardExpiredLock,
	isDBLocked,
	refreshLock,
	releaseLock,
} from "./lock";
import { collections } from "$lib/server/database";

describe("migrations", () => {
	it("should not have duplicates guid", async () => {
		const guids = migrations.map((m) => m.guid);
		const uniqueGuids = [...new Set(guids)];
		expect(uniqueGuids.length).toBe(guids.length);
	});

	it("should initialize only one semaphore", async () => {
		const results = await Promise.all(new Array(1000).fill(0).map(() => createAndAcquireLock()));
		const locks = results.filter((r) => r);

		const semaphores = await collections.semaphores.find({}).toArray();

		expect(locks.length).toBe(1);
		expect(semaphores).toBeDefined();
		expect(semaphores[0].isDBLocked).toBe(true);
		expect(semaphores.length).toBe(1);
	});

	it("should hold the lock when initializing the semaphore", async () => {
		await createAndAcquireLock();
		expect(await acquireLock()).toBe(false);

		await releaseLock();
		expect(await acquireLock()).toBe(true);
	});

	it("should acquire only one lock on DB", async () => {
		await createAndAcquireLock();
		await releaseLock();
		const results = await Promise.all(new Array(1000).fill(0).map(() => acquireLock()));
		const locks = results.filter((r) => r);
		expect(locks.length).toBe(1);
	});

	it("should read the lock correctly", async () => {
		expect(await createAndAcquireLock()).toBe(true);
		expect(await isDBLocked()).toBe(true);
		await releaseLock();
		expect(await isDBLocked()).toBe(false);
	});

	it("should discard expired lock", async () => {
		await createAndAcquireLock();

		// set the updatedAt in the past for testing
		await collections.semaphores.updateOne({}, { $set: { updatedAt: new Date(0) } });

		expect(await isDBLocked()).toBe(true);
		expect(await discardExpiredLock()).toBe(true);
		expect(await isDBLocked()).toBe(false);
	});

	it("should refresh the lock", async () => {
		await createAndAcquireLock();

		// get the updatedAt time

		const updatedAtInitially = (await collections.semaphores.findOne({}))?.updatedAt;

		await refreshLock();

		const updatedAtAfterRefresh = (await collections.semaphores.findOne({}))?.updatedAt;

		expect(updatedAtInitially).toBeDefined();
		expect(updatedAtAfterRefresh).toBeDefined();
		expect(updatedAtInitially).not.toBe(updatedAtAfterRefresh);
	});
});

afterEach(async () => {
	await collections.semaphores.deleteMany({});
	await collections.migrationResults.deleteMany({});
});
