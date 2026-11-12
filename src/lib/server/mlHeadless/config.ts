import { config } from "$lib/server/config";
import { z } from "zod";

const schema = z.object({
	hfToken: z.string().min(1),
	maxBudgetUsd: z.coerce.number().finite().min(0).max(10_000).default(25),
	publishNamespace: z
		.string()
		.regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/)
		.optional(),
	billingOrganization: z.string().optional(),
	billingResourceGroup: z.string().optional(),
	allowedUsers: z.array(z.string()).default([]),
});
export type HeadlessConfig = z.infer<typeof schema>;

/** Server-side settings for unattended ML Intern runs started over the API. */
export function headlessConfig(): HeadlessConfig | undefined {
	if (config.ML_HEADLESS_ENABLED !== "true") return undefined;
	const parsed = schema.safeParse({
		hfToken: config.ML_HEADLESS_HF_TOKEN,
		maxBudgetUsd: config.ML_HEADLESS_MAX_BUDGET_USD || "25",
		publishNamespace: config.ML_HEADLESS_PUBLISH_NAMESPACE?.trim() || undefined,
		billingOrganization: config.ML_HEADLESS_BILLING_ORGANIZATION || undefined,
		billingResourceGroup: config.ML_HEADLESS_BILLING_RESOURCE_GROUP || undefined,
		allowedUsers: (config.ML_HEADLESS_ALLOWED_USERS || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	});
	// Never include Zod's input or a credential in errors/logs.
	if (!parsed.success)
		throw new Error("Invalid headless ML Intern configuration: check the token and budget.");
	if (parsed.data.billingResourceGroup && !parsed.data.billingOrganization) {
		throw new Error("Headless ML Intern billing resource group requires an organization.");
	}
	return parsed.data;
}
