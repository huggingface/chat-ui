type BillingLocals = {
	billingOrganization?: string;
	billingResourceGroup?: string;
};

/** Resolve the payer identifier accepted by Inference Providers. */
export function inferenceBillingTarget(locals: BillingLocals | undefined): string | undefined {
	const organization = locals?.billingOrganization?.trim();
	if (!organization) return undefined;
	return locals?.billingResourceGroup?.trim() || organization;
}
