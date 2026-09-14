import { describe, expect, it } from "vitest";
import { billingTarget, inferenceBillingHeaders, inferenceBillingTarget } from "./billing";

describe("inferenceBillingTarget", () => {
	it("uses the organization root when no resource group is selected", () => {
		expect(inferenceBillingTarget({ billingOrganization: " acme " })).toBe("acme");
	});

	it("uses the resource group id for inference attribution", () => {
		expect(
			inferenceBillingTarget({
				billingOrganization: "acme",
				billingResourceGroup: " 65f000000000000000000001 ",
			})
		).toBe("65f000000000000000000001");
	});

	it("ignores an orphaned resource group", () => {
		expect(
			inferenceBillingTarget({ billingResourceGroup: "65f000000000000000000001" })
		).toBeUndefined();
	});

	it("derives every inference representation from one normalized target", () => {
		const locals = {
			billingOrganization: " acme ",
			billingResourceGroup: " 65f000000000000000000001 ",
		};
		expect(billingTarget(locals)).toEqual({
			organization: "acme",
			resourceGroupId: "65f000000000000000000001",
		});
		expect(inferenceBillingHeaders(locals)).toEqual({
			"X-HF-Bill-To": "65f000000000000000000001",
		});
		expect(inferenceBillingHeaders(undefined)).toEqual({});
	});
});
