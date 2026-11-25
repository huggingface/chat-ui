import { beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { clearOutOfCredits, markOutOfCredits } from "./outOfCredits";

describe("out-of-credits flag", () => {
	beforeAll(async () => {
		await ready;
	});

	it("is set by a 402 and cleared by the next completed turn", async () => {
		const _id = new ObjectId();
		await collections.users.insertOne({
			_id,
			name: "t",
			avatarUrl: undefined,
			hfUserId: _id.toString(),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		await markOutOfCredits(_id);
		expect((await collections.users.findOne({ _id }))?.outOfCreditsAt).toBeInstanceOf(Date);

		await clearOutOfCredits(_id);
		expect(await collections.users.findOne({ _id })).not.toHaveProperty("outOfCreditsAt");
	});
});
