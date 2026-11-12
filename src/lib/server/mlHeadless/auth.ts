import { error } from "@sveltejs/kit";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";
import type { User } from "$lib/types/User";
import { headlessConfig, type HeadlessConfig } from "./config";
import { isAllowedCaller, provisionHeadlessIdentity } from "./identity";

/**
 * Gate for every headless runs endpoint: 404 when the feature is off, 401
 * without a caller, 403 for a caller who is neither the token's account nor
 * listed in ML_HEADLESS_ALLOWED_USERS. Returns the identity runs execute as.
 */
export async function requireHeadlessCaller(
	locals: App.Locals
): Promise<{ settings: HeadlessConfig; identity: User }> {
	const settings = ML_ASSISTANT_MODE ? headlessConfig() : undefined;
	if (!settings) error(404, "Not found");
	if (!locals.user) error(401, "Authenticate with an HF token: Authorization: Bearer hf_…");
	if (!(await isAllowedCaller(locals.user, settings))) {
		error(403, "This account may not start headless ML Intern runs.");
	}
	return { settings, identity: await provisionHeadlessIdentity(settings) };
}
