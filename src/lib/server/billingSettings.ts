import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";

/** Load the signed-in user's billing choice for routes outside conversation generation. */
export async function loadBillingSettings(locals: App.Locals): Promise<void> {
	if (!locals.user) return;
	const settings = await collections.settings.findOne(authCondition(locals), {
		projection: { billingOrganization: 1, billingResourceGroup: 1 },
	});
	locals.billingOrganization = settings?.billingOrganization;
	locals.billingResourceGroup = settings?.billingResourceGroup;
}
