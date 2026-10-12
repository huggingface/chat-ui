import { config } from "$lib/server/config";
import { z } from "zod";

const schema = z.object({
	teamId: z.string().regex(/^T[A-Z0-9]+$/),
	botToken: z.string().startsWith("xoxb-"),
	appToken: z.string().startsWith("xapp-"),
	hfToken: z.string().min(1),
	budgetUsd: z.coerce.number().finite().min(0).max(10_000).default(0),
	publishNamespace: z
		.string()
		.regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/)
		.optional(),
	billingOrganization: z.string().optional(),
	billingResourceGroup: z.string().optional(),
	allowedChannels: z.array(z.string()).default([]),
});
export type SlackConfig = z.infer<typeof schema>;

export function slackConfig(): SlackConfig | undefined {
	if (config.SLACK_ML_ENABLED !== "true") return undefined;
	const parsed = schema.safeParse({
		teamId: config.SLACK_ML_TEAM_ID,
		botToken: config.SLACK_ML_BOT_TOKEN,
		appToken: config.SLACK_ML_APP_TOKEN,
		hfToken: config.SLACK_ML_HF_TOKEN,
		budgetUsd: config.SLACK_ML_BUDGET_USD || "0",
		publishNamespace: config.SLACK_ML_PUBLISH_NAMESPACE?.trim() || undefined,
		billingOrganization: config.SLACK_ML_BILLING_ORGANIZATION || undefined,
		billingResourceGroup: config.SLACK_ML_BILLING_RESOURCE_GROUP || undefined,
		allowedChannels: (config.SLACK_ML_ALLOWED_CHANNELS || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	});
	// Never include Zod's input or a credential in errors/logs.
	if (!parsed.success)
		throw new Error("Invalid Slack ML configuration: check team ID, tokens and budget.");
	if (parsed.data.billingResourceGroup && !parsed.data.billingOrganization) {
		throw new Error("Slack ML billing resource group requires an organization.");
	}
	return parsed.data;
}
