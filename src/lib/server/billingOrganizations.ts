import { error } from "@sveltejs/kit";
import { logger } from "$lib/server/logger";

export interface BillingResourceGroup {
	sub: string;
	name: string;
	role: string;
}

export interface BillingOrganization {
	sub: string;
	name: string;
	preferred_username: string;
	/** Enterprise resource groups the user belongs to in this organisation. */
	resourceGroups: BillingResourceGroup[];
}

interface UserInfoOrganization {
	sub: string;
	name: string;
	preferred_username: string;
	canPay?: boolean;
	plan?: string;
	roleInOrg?: string;
	resourceGroups?: BillingResourceGroup[];
}

const canSubmitComputeToResourceGroup = (groupRole: string, organizationRole?: string): boolean =>
	organizationRole === "admin" || groupRole === "admin" || groupRole === "write";

/**
 * The organisations this user may bill through the app, and whether they may
 * bill themselves, from the Hub's OAuth userinfo. `undefined` when the Hub
 * could not be asked.
 */
export async function fetchBillableOrganizations(
	token: string
): Promise<{ userCanPay: boolean; organizations: BillingOrganization[] } | undefined> {
	const response = await fetch("https://huggingface.co/oauth/userinfo", {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!response.ok) {
		logger.error(`Failed to fetch billing orgs: ${response.status}`);
		return undefined;
	}
	const data = (await response.json()) as { canPay?: boolean; orgs?: UserInfoOrganization[] };
	return {
		userCanPay: data.canPay ?? false,
		organizations: (data.orgs ?? [])
			.filter((org) => org.plan || org.canPay === true)
			.map(({ sub, name, preferred_username, roleInOrg, resourceGroups }) => ({
				sub,
				name,
				preferred_username,
				resourceGroups: (resourceGroups ?? [])
					.filter((group) => canSubmitComputeToResourceGroup(group.role, roleInOrg))
					.map(({ sub, name, role }) => ({ sub, name, role })),
			})),
	};
}

/**
 * Refuses a billing target the user cannot bill through this app.
 *
 * A financial setting is checked when it changes, not when it is read back:
 * the org list the settings page fetches only cleans up after the fact, and an
 * API client never fetches it. Asks the Hub, so callers run it on a change of
 * value only. Personal (empty) needs no check.
 */
export async function assertBillableOrganization(
	locals: Pick<App.Locals, "token">,
	organization: string,
	resourceGroup?: string
): Promise<void> {
	if (!locals.token) error(401, "Log in again to change who is billed.");
	const billable = await fetchBillableOrganizations(locals.token);
	if (!billable) error(502, "Could not verify billing eligibility with Hugging Face.");
	const selected = billable.organizations.find((org) => org.preferred_username === organization);
	if (!selected) {
		error(400, `Organization "${organization}" cannot be billed from this account.`);
	}
	if (resourceGroup && !selected.resourceGroups.some((group) => group.sub === resourceGroup)) {
		error(
			400,
			`Resource group "${resourceGroup}" cannot submit billed compute in "${organization}".`
		);
	}
}
