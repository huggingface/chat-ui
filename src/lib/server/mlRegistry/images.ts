import type { Message } from "$lib/types/Message";
import type { MlRegistryImage } from "$lib/types/MlRegistry";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolCallUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { callArguments } from "$lib/utils/messageShape";

type StoredImage = { sha: string; mimeType: string };

const isStoredImage = (block: unknown): block is StoredImage => {
	if (typeof block !== "object" || block === null) return false;
	const obj = block as Record<string, unknown>;
	return obj.type === "image" && typeof obj.sha === "string" && typeof obj.mimeType === "string";
};

/** hf_fs attach takes one uri per operation and answers with one image block per attach */
function attachedUris(call: MessageToolCallUpdate): string[] {
	const args = callArguments(call);
	const operations = Array.isArray(args.operations) ? args.operations : [args];
	return operations.flatMap((operation: unknown) => {
		if (typeof operation !== "object" || operation === null) return [];
		const { cmd, args: opArgs } = operation as { cmd?: unknown; args?: unknown };
		const uri = Array.isArray(opArgs) ? opArgs[0] : undefined;
		return cmd === "attach" && typeof uri === "string" ? [uri] : [];
	});
}

/**
 * every image a tool result stored by sha, one row per distinct image, newest first
 * an image that failed to upload stays inline and has no url, so it is left out
 */
export function listToolImages(messages: Message[]): MlRegistryImage[] {
	const calls = new Map<string, MessageToolCallUpdate>();
	const images = new Map<string, MlRegistryImage>();
	for (const message of messages) {
		for (const update of message.updates ?? []) {
			if (update.type !== MessageUpdateType.Tool) continue;
			if (update.subtype === MessageToolUpdateType.Call) {
				calls.set(update.uuid, update);
				continue;
			}
			if (update.subtype !== MessageToolUpdateType.Result) continue;
			if (update.result.status !== ToolResultStatus.Success) continue;
			const blocks = update.result.outputs.flatMap((output) =>
				Array.isArray(output.content) ? output.content.filter(isStoredImage) : []
			);
			if (blocks.length === 0) continue;
			const call = calls.get(update.uuid);
			const tool = call?.call.name ?? update.result.call.name;
			const uris = call ? attachedUris(call) : [];
			// unequal counts would pair a uri with the wrong image
			const sourced = uris.length === blocks.length;
			blocks.forEach((block, index) => {
				const seen = images.get(block.sha);
				// deleted and set again so the map keeps them in order of last return
				images.delete(block.sha);
				images.set(block.sha, {
					sha: block.sha,
					mimeType: block.mimeType,
					tool,
					...(sourced ? { source: uris[index] } : seen?.source ? { source: seen.source } : {}),
					count: (seen?.count ?? 0) + 1,
				});
			});
		}
	}
	return [...images.values()].reverse();
}
