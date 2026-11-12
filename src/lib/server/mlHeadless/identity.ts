import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { collections } from "$lib/server/database";
import type { User } from "$lib/types/User";
import { headlessConfig, type HeadlessConfig } from "./config";
import { headlessSessionId } from "./session";

/**
 * Headless runs act as the HF account that owns ML_HEADLESS_HF_TOKEN. Its user row carries
 * that account's real hfUserId, so signing in to the UI as the same account shows every run.
 * Like the shared Slack identity, the token is read from server configuration on every
 * resume and never stored with a conversation.
 */

const account = z.object({ id: z.string().min(1), name: z.string().min(1) });
type Account = z.infer<typeof account>;

let cached: { tokenHash: string; account: Account } | undefined;

export async function tokenAccount(settings: HeadlessConfig): Promise<Account> {
	const tokenHash = createHash("sha256").update(settings.hfToken).digest("hex");
	if (cached?.tokenHash === tokenHash) return cached.account;
	const response = await fetch("https://huggingface.co/api/whoami-v2", {
		headers: { Authorization: `Bearer ${settings.hfToken}` },
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error("Headless ML Intern HF token could not be validated.");
	const parsed = account.parse(await response.json());
	cached = { tokenHash, account: parsed };
	return parsed;
}

/** Test hook: forget the cached whoami result. */
export function resetHeadlessAccountCache(): void {
	cached = undefined;
}

/** The token's account as a user, created on first use so its own token passes bearer auth. */
export async function provisionHeadlessIdentity(settings: HeadlessConfig): Promise<User> {
	const owner = await tokenAccount(settings);
	const now = new Date();
	const user = await collections.users.findOneAndUpdate(
		{ hfUserId: owner.id },
		{
			$setOnInsert: {
				_id: new ObjectId(),
				hfUserId: owner.id,
				username: owner.name,
				name: owner.name,
				avatarUrl: undefined,
				createdAt: now,
				updatedAt: now,
			},
		},
		{ upsert: true, returnDocument: "after" }
	);
	if (!user) throw new Error("Could not provision the headless ML Intern identity.");
	return user;
}

export async function headlessLocals(user: User): Promise<App.Locals> {
	const settings = headlessConfig();
	if (!settings) throw new Error("Headless ML Intern runs are disabled on this server.");
	const owner = await tokenAccount(settings);
	if (owner.id !== user.hfUserId) {
		throw new Error("The headless ML Intern token now belongs to a different account.");
	}
	return {
		user,
		sessionId: headlessSessionId(user._id),
		isAdmin: false,
		token: settings.hfToken,
		publishNamespace: settings.publishNamespace,
		billingOrganization: settings.billingOrganization,
		billingResourceGroup: settings.billingResourceGroup,
	};
}

/**
 * Headless credentials for a resume, or undefined when the feature is off or the token now
 * belongs to someone else. The caller then falls back to the account's own browser session.
 */
export async function activeHeadlessLocals(user: User): Promise<App.Locals | undefined> {
	try {
		return await headlessLocals(user);
	} catch {
		return undefined;
	}
}

/** The token's own account may always call; others must be listed by username. */
export async function isAllowedCaller(
	caller: User | undefined,
	settings: HeadlessConfig
): Promise<boolean> {
	if (!caller) return false;
	if (caller.username && settings.allowedUsers.includes(caller.username)) return true;
	const owner = await tokenAccount(settings);
	return caller.hfUserId === owner.id;
}
