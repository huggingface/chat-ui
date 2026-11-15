import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { config } from "$lib/server/config";
import type { SettingsEditable } from "$lib/types/Settings";
import { resolveStreamingMode } from "$lib/utils/messageUpdates";
import { assertBillingTargetChange, parseSettingsPayload } from "$lib/server/settingsValidation";

export async function POST({ request, locals }) {
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
		{
			upsert: true,
		}
	);
	// return ok response
	return new Response();
}
