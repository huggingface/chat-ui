import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { config } from "$lib/server/config";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { defaultModel, models, validateModel } from "$lib/server/models";
import { DEFAULT_SETTINGS, type SettingsEditable } from "$lib/types/Settings";
import { resolveStreamingMode } from "$lib/utils/messageUpdates";
import { assertBillingTargetChange, parseSettingsPayload } from "$lib/server/settingsValidation";

export const GET: RequestHandler = async ({ locals }) => {
	requireAuth(locals);
	const settings = await collections.settings.findOne(authCondition(locals));

	if (settings && !validateModel(models).safeParse(settings?.activeModel).success) {
		settings.activeModel = defaultModel.id;
		await collections.settings.updateOne(authCondition(locals), {
			$set: { activeModel: defaultModel.id },
		});
	}

	// if the model is unlisted, set the active model to the default model
	if (
		settings?.activeModel &&
		models.find((m) => m.id === settings?.activeModel)?.unlisted === true
	) {
		settings.activeModel = defaultModel.id;
		await collections.settings.updateOne(authCondition(locals), {
			$set: { activeModel: defaultModel.id },
		});
	}

	const streamingMode = resolveStreamingMode(settings ?? {});

	return superjsonResponse({
		welcomeModalSeen: !!settings?.welcomeModalSeenAt,
		welcomeModalSeenAt: settings?.welcomeModalSeenAt ?? null,
		mlInternOnboardingSeen: !!settings?.mlInternOnboardingSeenAt,

		activeModel: settings?.activeModel ?? DEFAULT_SETTINGS.activeModel,
		streamingMode,
		directPaste: settings?.directPaste ?? DEFAULT_SETTINGS.directPaste,
		hapticsEnabled: settings?.hapticsEnabled ?? DEFAULT_SETTINGS.hapticsEnabled,
		hidePromptExamples: settings?.hidePromptExamples ?? DEFAULT_SETTINGS.hidePromptExamples,
		shareConversationsWithModelAuthors:
			settings?.shareConversationsWithModelAuthors ??
			DEFAULT_SETTINGS.shareConversationsWithModelAuthors,

		customPrompts: settings?.customPrompts ?? {},
		customPromptsEnabled: settings?.customPromptsEnabled ?? {},
		// On HuggingChat, tool/multimodal capability comes from the upstream router,
		// so we hide any per-user overrides (existing or new) instead of letting them apply.
		multimodalOverrides: config.isHuggingChat ? {} : (settings?.multimodalOverrides ?? {}),
		toolsOverrides: config.isHuggingChat ? {} : (settings?.toolsOverrides ?? {}),
		// Not provider-determined, so user-editable even on HuggingChat
		artifactsOverrides: settings?.artifactsOverrides ?? {},
		providerOverrides: settings?.providerOverrides ?? {},
		reasoningEffortOverrides: settings?.reasoningEffortOverrides ?? {},
		reasoningOverrides: config.isHuggingChat ? {} : (settings?.reasoningOverrides ?? {}),
		billingOrganization: settings?.billingOrganization ?? undefined,
		billingResourceGroup: settings?.billingResourceGroup ?? undefined,
	});
};

export const POST: RequestHandler = async ({ locals, request }) => {
	requireAuth(locals);
	const body = await request.json();

	const { welcomeModalSeen, mlInternOnboardingSeen, ...parsedSettings } =
		parseSettingsPayload(body);
	const streamingMode = resolveStreamingMode(parsedSettings);

	if (config.isHuggingChat) {
		parsedSettings.multimodalOverrides = {};
		parsedSettings.toolsOverrides = {};
		parsedSettings.reasoningOverrides = {};
	}

	await assertBillingTargetChange(locals, parsedSettings);

	const settings = {
		...parsedSettings,
		streamingMode,
	} satisfies SettingsEditable;

	await collections.settings.updateOne(
		authCondition(locals),
		{
			$set: {
				...settings,
				...(welcomeModalSeen && { welcomeModalSeenAt: new Date() }),
				...(mlInternOnboardingSeen && { mlInternOnboardingSeenAt: new Date() }),
				updatedAt: new Date(),
			},
			$setOnInsert: {
				createdAt: new Date(),
			},
		},
		{ upsert: true }
	);

	return new Response();
};
