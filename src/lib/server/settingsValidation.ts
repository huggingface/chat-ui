import { error } from "@sveltejs/kit";
import { z } from "zod";
import { authCondition } from "$lib/server/auth";
import { assertBillableOrganization } from "$lib/server/billingOrganizations";
import { config } from "$lib/server/config";
import { collections } from "$lib/server/database";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";

export const settingsSchema = z
	.object({
		shareConversationsWithModelAuthors: z
			.boolean()
			.default(DEFAULT_SETTINGS.shareConversationsWithModelAuthors),
		welcomeModalSeen: z.boolean().optional(),
		mlInternOnboardingSeen: z.boolean().optional(),
		activeModel: z.string().default(DEFAULT_SETTINGS.activeModel),
		customPrompts: z.record(z.string()).default({}),
		customPromptsEnabled: z.record(z.boolean()).default({}),
		multimodalOverrides: z.record(z.boolean()).default({}),
		toolsOverrides: z.record(z.boolean()).default({}),
		artifactsOverrides: z.record(z.boolean()).default({}),
		providerOverrides: z.record(z.string()).default({}),
		reasoningEffortOverrides: z.record(z.enum(["low", "medium", "high"])).default({}),
		reasoningOverrides: z.record(z.boolean()).default({}),
		streamingMode: z.enum(["raw", "smooth"]).optional(),
		directPaste: z.boolean().default(false),
		hapticsEnabled: z.boolean().default(true),
		hidePromptExamples: z.record(z.boolean()).default({}),
		billingOrganization: z.string().optional(),
		billingResourceGroup: z
			.string()
			.regex(/^[a-f\d]{24}$/i)
			.or(z.literal(""))
			.optional(),
	})
	.refine((settings) => !settings.billingResourceGroup || Boolean(settings.billingOrganization), {
		message: "A billing resource group requires its organization",
		path: ["billingResourceGroup"],
	});

export type ParsedSettings = z.infer<typeof settingsSchema>;

export function parseSettingsPayload(body: unknown): ParsedSettings {
	const result = settingsSchema.safeParse(body);
	if (!result.success) {
		const detail = result.error.issues
			.map((issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`)
			.join("; ");
		error(400, detail || "Invalid settings");
	}
	return result.data;
}

/** Verify a changed financial target once, without delaying unrelated settings saves. */
export async function assertBillingTargetChange(
	locals: App.Locals,
	settings: Pick<ParsedSettings, "billingOrganization" | "billingResourceGroup">
): Promise<void> {
	if (!config.isHuggingChat || !settings.billingOrganization) return;
	const current = await collections.settings.findOne(authCondition(locals), {
		projection: { billingOrganization: 1, billingResourceGroup: 1 },
	});
	const resourceGroup = settings.billingResourceGroup || undefined;
	if (
		current?.billingOrganization !== settings.billingOrganization ||
		(current?.billingResourceGroup || undefined) !== resourceGroup
	) {
		await assertBillableOrganization(locals, settings.billingOrganization, resourceGroup);
	}
}
