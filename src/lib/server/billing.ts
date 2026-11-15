export type BillingLocals = {
	billingOrganization?: string;
	billingResourceGroup?: string;
};

export interface BillingTarget {
	organization: string;
	resourceGroupId?: string;
}

/** Normalize the billing choice once for every wire protocol that consumes it. */
export function billingTarget(locals: BillingLocals | undefined): BillingTarget | undefined {
	const organization = locals?.billingOrganization?.trim();
	if (!organization) return undefined;
	const resourceGroupId = locals?.billingResourceGroup?.trim();
	return { organization, ...(resourceGroupId ? { resourceGroupId } : {}) };
}

/** Resolve the payer identifier accepted by Inference Providers. */
export function inferenceBillingTarget(locals: BillingLocals | undefined): string | undefined {
	const target = billingTarget(locals);
	return target?.resourceGroupId ?? target?.organization;
}

/** Headers accepted by the Hugging Face inference router for cost attribution. */
export function inferenceBillingHeaders(locals: BillingLocals | undefined): Record<string, string> {
	const target = inferenceBillingTarget(locals);
	return target ? { "X-HF-Bill-To": target } : {};
}
