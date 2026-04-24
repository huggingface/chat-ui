import { collections } from "$lib/server/database";
import type { Filter } from "mongodb";
import type { Settings } from "$lib/types/Settings";
import { logger } from "$lib/server/logger";

export type SettingsAuthFilter = Filter<Settings>;

export function policyKey(serverName: string, toolName: string): string {
	return `${serverName}::${toolName}`;
}

export async function getAlwaysAllowedTools(authFilter: SettingsAuthFilter): Promise<Set<string>> {
	try {
		const doc = await collections.settings.findOne(authFilter);
		const policies = doc?.mcpToolPolicies ?? [];
		return new Set(
			policies.filter((p) => p.policy === "allow").map((p) => policyKey(p.serverName, p.toolName))
		);
	} catch (err) {
		logger.warn({ err: String(err) }, "[mcp] failed to read tool policies");
		return new Set();
	}
}

export async function persistAlwaysAllow(
	authFilter: SettingsAuthFilter,
	serverName: string,
	toolName: string
): Promise<void> {
	try {
		await collections.settings.updateOne(
			authFilter,
			{
				$addToSet: { mcpToolPolicies: { serverName, toolName, policy: "allow" } },
				$set: { updatedAt: new Date() },
				$setOnInsert: { createdAt: new Date() },
			},
			{ upsert: true }
		);
	} catch (err) {
		logger.warn(
			{ err: String(err), serverName, toolName },
			"[mcp] failed to persist always-allow policy"
		);
	}
}
