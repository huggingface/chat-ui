import { ObjectId } from "mongodb";
import { config } from "$lib/server/config";
import { collections } from "$lib/server/database";
import { createSecretBox } from "$lib/server/secretBox";
import type { MlAutomation } from "$lib/types/MlAutomation";
import type { User } from "$lib/types/User";

const box = createSecretBox(
	() => config.SESSION_OAUTH_ENCRYPTION_KEY,
	"[ml automations] SESSION_OAUTH_ENCRYPTION_KEY is not set; automation Hub tokens are stored unencrypted."
);

export const sealToken = (token: string) => box.encrypt(token);

const PREFIX = "ml-automation:";

export const automationSessionId = (id: ObjectId) => `${PREFIX}${id.toHexString()}`;

export function parseAutomationSessionId(id?: string): ObjectId | undefined {
	const hex = id?.startsWith(PREFIX) ? id.slice(PREFIX.length) : undefined;
	return hex && ObjectId.isValid(hex) ? new ObjectId(hex) : undefined;
}

export class AutomationIdentityError extends Error {}

/** the run acts as the automation owner with the token they gave it, never a browser session */
export function automationLocals(
	automation: MlAutomation,
	user: User
): App.Locals & { user: User } {
	if (!user._id.equals(automation.userId))
		throw new AutomationIdentityError("This automation belongs to another account.");
	const token = box.decrypt(automation.token);
	if (!token)
		throw new AutomationIdentityError(
			"This automation's Hub token can no longer be read. Add the token again."
		);
	return {
		user,
		sessionId: automationSessionId(automation._id),
		isAdmin: false,
		token,
		publishNamespace: user.username,
		billingOrganization: automation.billTo?.organization,
		billingResourceGroup: automation.billTo?.resourceGroup,
	};
}

/** resumes keep acting as the automation, a deleted one ends its runs */
export async function rebuildAutomationIdentity(automationId: ObjectId, ownerId?: ObjectId) {
	const automation = await collections.mlAutomations.findOne({ _id: automationId });
	if (!automation || !ownerId?.equals(automation.userId))
		throw new AutomationIdentityError("This automation no longer exists.");
	const user = await collections.users.findOne({ _id: automation.userId });
	if (!user) throw new AutomationIdentityError("This automation's owner no longer exists.");
	const settings = await collections.settings.findOne({ userId: user._id });
	return { locals: automationLocals(automation, user), settings, tokenExpired: false };
}
