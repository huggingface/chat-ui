import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { loginEnabled } from "$lib/server/auth";
import { config } from "$lib/server/config";
import { getVoiceChatProvider, isVoiceChatEnabled } from "$lib/server/voice";
import type { FeatureFlags } from "$lib/server/api/types";

export const GET: RequestHandler = async ({ locals }) => {
	return superjsonResponse({
		enableAssistants: config.ENABLE_ASSISTANTS === "true",
		loginEnabled,
		isAdmin: locals.isAdmin,
		transcriptionEnabled: !!config.get("TRANSCRIPTION_MODEL"),
		voiceChatEnabled: isVoiceChatEnabled(),
		voiceChatProvider: getVoiceChatProvider(),
	} satisfies FeatureFlags);
};
