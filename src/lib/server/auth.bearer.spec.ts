import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cookies } from "@sveltejs/kit";
import { collections, ready } from "$lib/server/database";
import { authenticateRequest } from "$lib/server/auth";
import { sha256 } from "$lib/utils/sha256";
import { cleanupTestData, createTestUser } from "$lib/server/api/__tests__/testHelpers";

const noCookies = { get: () => undefined } as unknown as Cookies;
const url = new URL("http://localhost/api/v2/conversations");

function stubWhoami(body: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(body))
	);
}

function bearer(token: string) {
	return new Headers({ Authorization: `Bearer ${token}` });
}

beforeAll(async () => {
	await ready;
}, 30000);

describe("authenticateRequest with a Bearer token", () => {
	beforeEach(async () => {
		await cleanupTestData();
	}, 20000);

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("signs in the owner of a personal access token", async () => {
		const { user } = await createTestUser();
		stubWhoami({ id: user.hfUserId, auth: { type: "access_token" } });

		const auth = await authenticateRequest(bearer("hf_pat"), noCookies, url, true);

		expect(auth.user?._id.toString()).toBe(user._id.toString());
		expect(await collections.tokenCaches.countDocuments()).toBe(1);
	});

	it.each([
		["an OAuth token", { auth: { type: "oauth" } }],
		["an app token", { auth: { type: "app_token" } }],
		["a whoami without auth info", {}],
	])("refuses %s and does not cache it", async (_, extra) => {
		const { user } = await createTestUser();
		stubWhoami({ id: user.hfUserId, ...extra });

		await expect(authenticateRequest(bearer("hf_oauth"), noCookies, url, true)).rejects.toThrow(
			"Unauthorized"
		);
		expect(
			await collections.tokenCaches.findOne({ tokenHash: await sha256("hf_oauth") })
		).toBeNull();
	});
});
