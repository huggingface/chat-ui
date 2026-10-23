import { z } from "zod";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
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

export interface SavedMcpSelection {
	_id: ObjectId;
	encryptedSelection: string;
	updatedAt: Date;
}

export async function saveMcpSelection(userId: ObjectId, input: unknown) {
	const selection = mcpSelectionSchema.parse(input);
	if (!config.MCP_OAUTH_ENCRYPTION_KEY?.trim())
		throw new Error("MCP selection sync requires MCP_OAUTH_ENCRYPTION_KEY");
	const encryptedSelection = encryptSecret(JSON.stringify(selection));
	if (!encryptedSelection.startsWith("enc.v1:")) throw new Error("MCP selection encryption failed");
	await collections.mcpSelections.updateOne(
		{ _id: userId },
		{ $set: { encryptedSelection, updatedAt: new Date() } },
		{ upsert: true }
	);
}

export async function loadMcpSelection(userId: ObjectId) {
	const saved = await collections.mcpSelections.findOne({ _id: userId });
	if (!saved) return undefined;
	// Never silently fall back to a different set of tools if saved credentials
	// cannot be decrypted (for example after an encryption-key rotation).
	return mcpSelectionSchema.parse(JSON.parse(decryptSecret(saved.encryptedSelection)));
}
