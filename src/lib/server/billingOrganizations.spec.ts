import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBillableOrganization, fetchBillableOrganizations } from "./billingOrganizations";

const userinfo = (body: unknown, status = 200) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

const GROUP = { sub: "65f000000000000000000001", name: "research", role: "write" };
const ORGS = [
	{ sub: "1", name: "Acme", preferred_username: "acme", plan: "team", resourceGroups: [GROUP] },
	{ sub: "2", name: "Payer", preferred_username: "payer", canPay: true },
	{ sub: "3", name: "Free", preferred_username: "free", canPay: false },
];

describe("fetchBillableOrganizations", () => {
	it("keeps the organisations with a plan or a payment method", async () => {
		vi.stubGlobal("fetch", userinfo({ canPay: true, orgs: ORGS }));
		const billable = await fetchBillableOrganizations("tok");

		expect(billable?.userCanPay).toBe(true);
		expect(billable?.organizations.map((org) => org.preferred_username)).toEqual(["acme", "payer"]);
		// Only the fields the client needs; the rest of userinfo stays server-side.
		expect(Object.keys(billable?.organizations[0] ?? {}).sort()).toEqual([
			"name",
			"preferred_username",
			"resourceGroups",
			"sub",
		]);
		expect(billable?.organizations[0].resourceGroups).toEqual([GROUP]);
		expect(billable?.organizations[1].resourceGroups).toEqual([]);
	});

	it("says so when the Hub could not be asked", async () => {
		vi.stubGlobal("fetch", userinfo({}, 503));
		expect(await fetchBillableOrganizations("tok")).toBeUndefined();
	});
});

describe("assertBillableOrganization", () => {
	const status = async (promise: Promise<unknown>) => {
		try {
			await promise;
			return undefined;
		} catch (err) {
			return (err as { status?: number }).status;
		}
	};

	it("lets a billable organisation through", async () => {
		vi.stubGlobal("fetch", userinfo({ orgs: ORGS }));
		await expect(assertBillableOrganization({ token: "tok" }, "acme")).resolves.toBeUndefined();
	});

	it("refuses one the user cannot bill", async () => {
		vi.stubGlobal("fetch", userinfo({ orgs: ORGS }));
		expect(await status(assertBillableOrganization({ token: "tok" }, "free"))).toBe(400);
		expect(await status(assertBillableOrganization({ token: "tok" }, "stranger"))).toBe(400);
	});

	it("checks a resource group against the organisation it was picked with", async () => {
		vi.stubGlobal("fetch", userinfo({ orgs: ORGS }));
		await expect(
			assertBillableOrganization({ token: "tok" }, "acme", GROUP.sub)
		).resolves.toBeUndefined();
		// A group the user is in, but in another organisation, is not this organisation's.
		expect(await status(assertBillableOrganization({ token: "tok" }, "payer", GROUP.sub))).toBe(
			400
		);
		expect(
			await status(assertBillableOrganization({ token: "tok" }, "acme", "65f000000000000000000099"))
		).toBe(400);
	});

	it("needs a login to check against, and the Hub to answer", async () => {
		vi.stubGlobal("fetch", userinfo({ orgs: ORGS }));
		expect(await status(assertBillableOrganization({}, "acme"))).toBe(401);
		vi.stubGlobal("fetch", userinfo({}, 500));
		expect(await status(assertBillableOrganization({ token: "tok" }, "acme"))).toBe(502);
	});
});
