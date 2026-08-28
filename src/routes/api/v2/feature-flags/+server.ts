import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { loginEnabled } from "$lib/server/auth";
import { config } from "$lib/server/config";
import type { FeatureFlags } from "$lib/server/api/types";

export const GET: RequestHandler = async ({ locals }) => {
	// Mirror the title-generation resolution (generateFromDefaultEndpoint): the
	// live TASK_MODEL value wins over the startup-resolved task model, so the
	// reported id stays correct when TASK_MODEL changes via the config manager.
	let taskModelId: string | null = null;
	const configuredTaskModel = config.TASK_MODEL;
	if (configuredTaskModel?.trim()) {
		try {
			const { models, taskModel } = await import("$lib/server/models");
			taskModelId = (models.find((m) => m.id === configuredTaskModel) ?? taskModel)?.id ?? null;
		} catch {
			taskModelId = null;
		}
	}

	return superjsonResponse({
		enableAssistants: config.ENABLE_ASSISTANTS === "true",
		loginEnabled,
		isAdmin: locals.isAdmin,
		transcriptionEnabled: !!config.get("TRANSCRIPTION_MODEL"),
		taskModelId,
	} satisfies FeatureFlags);
};
