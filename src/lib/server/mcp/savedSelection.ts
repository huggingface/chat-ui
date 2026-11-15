import { z } from "zod";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { encryptSecret, decryptSecret } from "./oauth/encryption";

// Match the web turn's selection format. OAuth tokens stay in the existing
// owner-checked OAuth store; manual headers are encrypted along with the selection.
export const mcpSelectionSchema = z.object({
	selectedMcpServerNames: z.array(z.string().max(256)).max(100),
	selectedMcpServers: z
		.array(
			z.object({
				name: z.string().min(1).max(256),
				url: z.string().url().max(4096),
				headers: z
					.array(z.object({ key: z.string().max(256), value: z.string().max(16384) }))
					.max(50)
					.optional(),
				oauthConnectionId: z
					.string()
					.regex(/^[a-f0-9]{24}$/i)
					.optional(),
			})
		)
		.max(100),
});
export type McpSelection = z.infer<typeof mcpSelectionSchema>;

/** The row is the owner's opt-in; the selection arrives with the browser's first sync. */
export interface SavedMcpSelection {
	_id: ObjectId;
	encryptedSelection?: string;
	updatedAt: Date;
}

export type LoadedMcpSelection =
	{ status: "none" } | { status: "ok"; selection: McpSelection } | { status: "unavailable" };

/** Without an encryption key the selection's headers cannot be stored, so the opt-in is hidden. */
export function slackMcpSyncAvailable() {
	return (
		config.SLACK_ML_ENABLED === "true" &&
		config.SLACK_ML_ACCOUNT_MODE === "user" &&
		Boolean(config.MCP_OAUTH_ENCRYPTION_KEY?.trim())
	);
}

/** Sync only for users who connected Slack and opted in, so nobody else's headers leave the browser. */
export async function mcpSyncStatus(userId: ObjectId) {
	if (!slackMcpSyncAvailable()) return null;
	const [saved, connection] = await Promise.all([
		collections.mcpSelections.findOne({ _id: userId }, { projection: { encryptedSelection: 1 } }),
		collections.slackConnections.findOne({ userId }, { projection: { _id: 1 } }),
	]);
	if (!saved || !connection) return null;
	return { saved: Boolean(saved.encryptedSelection) };
}

export async function setMcpSyncEnabled(userId: ObjectId, enabled: boolean) {
	if (!enabled || !slackMcpSyncAvailable()) {
		await collections.mcpSelections.deleteOne({ _id: userId });
		return;
	}
	await collections.mcpSelections.updateOne(
		{ _id: userId },
		{ $setOnInsert: { updatedAt: new Date() } },
		{ upsert: true }
	);
}

/** Returns false without writing when the owner has not opted in (or opted out meanwhile). */
export async function saveMcpSelection(userId: ObjectId, input: unknown) {
	const selection = mcpSelectionSchema.parse(input);
	if (!config.MCP_OAUTH_ENCRYPTION_KEY?.trim())
		throw new Error("MCP selection sync requires MCP_OAUTH_ENCRYPTION_KEY");
	const encryptedSelection = encryptSecret(JSON.stringify(selection));
	if (!encryptedSelection.startsWith("enc.v1:")) throw new Error("MCP selection encryption failed");
	const { matchedCount } = await collections.mcpSelections.updateOne(
		{ _id: userId },
		{ $set: { encryptedSelection, updatedAt: new Date() } }
	);
	return matchedCount > 0;
}

export async function loadMcpSelection(userId: ObjectId): Promise<LoadedMcpSelection> {
	const saved = await collections.mcpSelections.findOne({ _id: userId });
	if (!saved?.encryptedSelection) return { status: "none" };
	// A rotated or missing key decrypts to "". Callers then run with preset tools only,
	// never with stale credentials or someone else's selection.
	try {
		const selection = mcpSelectionSchema.parse(JSON.parse(decryptSecret(saved.encryptedSelection)));
		return { status: "ok", selection };
	} catch {
		logger.warn({ userId: userId.toString() }, "[mcp] saved MCP selection could not be read");
		return { status: "unavailable" };
	}
}

/** The shape conversationRequest attaches to locals.mcp. */
export function selectionLocals(selection: McpSelection) {
	return {
		selectedServerNames: selection.selectedMcpServerNames,
		selectedServers: selection.selectedMcpServers.map((server) => ({
			...server,
			headers: server.headers?.length
				? Object.fromEntries(server.headers.map(({ key, value }) => [key, value]))
				: undefined,
		})),
	};
}

export const MCP_RESYNC_NOTE =
	"Your HuggingChat MCP servers could not be loaded, so this run uses ML Intern's built-in tools only. Open HuggingChat to resync your MCP servers.";
