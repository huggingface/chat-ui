export const ADD_CREDITS_URL = "https://huggingface.co/settings/billing?add-credits=true";
export const UPGRADE_PRO_URL = "https://huggingface.co/subscribe/pro?from=HuggingChat";

export interface CreditsAction {
	label: string;
	href: string;
	external: boolean;
}

export interface OutOfCreditsCopy {
	title: string;
	body: string;
	notice: string;
	primary: CreditsAction;
	secondary?: CreditsAction;
}

export function outOfCreditsCopy({
	isPro,
	billingOrganization,
	settingsHref,
}: {
	/** null until the hub answers */
	isPro: boolean | null;
	billingOrganization?: string;
	settingsHref: string;
}): OutOfCreditsCopy {
	if (billingOrganization) {
		return {
			title: `${billingOrganization} is out of credits`,
			body: `Your messages are billed to ${billingOrganization}, and it has no credits left. An admin of ${billingOrganization} can add credits, or you can bill your own account instead.`,
			notice: `${billingOrganization} is out of credits, so messages can't be answered.`,
			primary: {
				label: `Open ${billingOrganization} billing`,
				href: `https://huggingface.co/organizations/${encodeURIComponent(billingOrganization)}/settings/billing`,
				external: true,
			},
			secondary: { label: "Change who pays", href: settingsHref, external: false },
		};
	}
	const addCredits = { label: "Add credits", href: ADD_CREDITS_URL, external: true };
	return {
		title: "You're out of credits",
		body:
			isPro === true
				? "HuggingChat runs models on Hugging Face Inference Providers, paid for with your account's credits. You've used them all, so your message wasn't answered. Add credits, then retry your message."
				: "HuggingChat runs models on Hugging Face Inference Providers, paid for with your account's credits, and your account has none left. Add credits to keep chatting, or upgrade to PRO to get monthly credits included.",
		notice: "You're out of credits, so messages can't be answered.",
		primary: addCredits,
		...(isPro === true
			? {}
			: { secondary: { label: "Upgrade to PRO", href: UPGRADE_PRO_URL, external: true } }),
	};
}
