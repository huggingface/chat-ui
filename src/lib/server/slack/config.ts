import { config } from "$lib/server/config";
import { z } from "zod";

const schema = z.object({
	teamId: z.string().regex(/^T[A-Z0-9]+$/),
	botToken: z.string().startsWith("xoxb-"),
	appToken: z.string().startsWith("xapp-"),
	hfToken: z.string(),
	accountMode: z.enum(["shared", "user"]).optional(),
	budgetUsd: z.coerce.number().finite().min(0).max(10_000).default(0),
	publishNamespace: z
		.string()
		.regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/)
		.optional(),
	billingOrganization: z.string().optional(),
	billingResourceGroup: z.string().optional(),
	allowedChannels: z.array(z.string()).default([]),
	/** Other workspaces may install the app through /slack/install; personal-account mode only. */
	publicInstall: z.boolean().optional(),
	clientId: z.string().optional(),
	clientSecret: z.string().optional(),
});
export type SlackConfig = z.infer<typeof schema>;

export function slackConfig(): SlackConfig | undefined {
	if (config.SLACK_ML_ENABLED !== "true") return undefined;
	const parsed = schema.safeParse({
		teamId: config.SLACK_ML_TEAM_ID,
		botToken: config.SLACK_ML_BOT_TOKEN,
		appToken: config.SLACK_ML_APP_TOKEN,
		hfToken: config.SLACK_ML_HF_TOKEN || "",
		accountMode: config.SLACK_ML_ACCOUNT_MODE || "shared",
		budgetUsd: config.SLACK_ML_BUDGET_USD || "0",
		publishNamespace: config.SLACK_ML_PUBLISH_NAMESPACE?.trim() || undefined,
		billingOrganization: config.SLACK_ML_BILLING_ORGANIZATION || undefined,
		billingResourceGroup: config.SLACK_ML_BILLING_RESOURCE_GROUP || undefined,
		allowedChannels: (config.SLACK_ML_ALLOWED_CHANNELS || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
		publicInstall: config.SLACK_ML_PUBLIC_INSTALL === "true",
		clientId: config.SLACK_ML_CLIENT_ID || undefined,
		clientSecret: config.SLACK_ML_CLIENT_SECRET || undefined,
	});
	// Never include Zod's input or a credential in errors/logs.
	if (!parsed.success)
		throw new Error("Invalid Slack ML configuration: check team ID, tokens and budget.");
	if (parsed.data.accountMode !== "user" && !parsed.data.hfToken)
		throw new Error("Shared Slack mode requires SLACK_ML_HF_TOKEN.");
	if (parsed.data.billingResourceGroup && !parsed.data.billingOrganization) {
		throw new Error("Slack ML billing resource group requires an organization.");
	}
	// Other workspaces' bot tokens are stored encrypted, and they never get a shared HF token.
	if (
		parsed.data.publicInstall &&
		(parsed.data.accountMode !== "user" ||
			!parsed.data.clientId ||
			!parsed.data.clientSecret ||
			!config.MCP_OAUTH_ENCRYPTION_KEY?.trim())
	)
		throw new Error(
			"Public Slack installs require user account mode, SLACK_ML_CLIENT_ID, SLACK_ML_CLIENT_SECRET and MCP_OAUTH_ENCRYPTION_KEY."
		);
	return parsed.data;
}
