import { describe, expect, it } from "vitest";
import { ADD_CREDITS_URL, UPGRADE_PRO_URL, outOfCreditsCopy } from "./outOfCredits";
import { isOutOfCredits } from "./paymentErrors";

const settingsHref = "/chat/settings/application";

describe("outOfCreditsCopy", () => {
	it("leads free users to add credits and offers PRO", () => {
		const copy = outOfCreditsCopy({ isPro: false, settingsHref });
		expect(copy.primary.href).toBe(ADD_CREDITS_URL);
		expect(copy.secondary?.href).toBe(UPGRADE_PRO_URL);
	});

	it("offers PRO while the account's plan is still unknown", () => {
		expect(outOfCreditsCopy({ isPro: null, settingsHref }).secondary?.href).toBe(UPGRADE_PRO_URL);
	});

	it("does not offer PRO to a PRO user", () => {
		const copy = outOfCreditsCopy({ isPro: true, settingsHref });
		expect(copy.primary.href).toBe(ADD_CREDITS_URL);
		expect(copy.secondary).toBeUndefined();
	});

	it("names the billing organization and points at its billing page", () => {
		const copy = outOfCreditsCopy({ isPro: false, billingOrganization: "acme", settingsHref });
		expect(copy.title).toBe("acme is out of credits");
		expect(copy.primary.href).toBe("https://huggingface.co/organizations/acme/settings/billing");
		expect(copy.secondary).toEqual({
			label: "Change who pays",
			href: settingsHref,
			external: false,
		});
	});
});

describe("isOutOfCredits", () => {
	it.each([
		[402, undefined, true],
		[402, "PrepaidCreditsRequired", true],
		[402, "PaymentMethodRequired", false],
		[402, "PayAsYouGoNotEnabled", false],
		[402, "InferenceRequestLimitReached", false],
		[402, "BillingAccountProvisioning", false],
		[403, undefined, false],
		[undefined, undefined, false],
	])("status %s code %s → %s", (status, code, expected) => {
		expect(isOutOfCredits(status, code)).toBe(expected);
	});
});
