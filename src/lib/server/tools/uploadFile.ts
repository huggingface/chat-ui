import type { Conversation } from "$lib/types/Conversation";
import { sha256 } from "$lib/utils/sha256";
import type { Tool } from "@huggingface/agents/src/types";
import { collections } from "../database";

export async function uploadFile(file: Blob, conv: Conversation, tool?: Tool) {
	const sha = await sha256(await file.text());
	const filename = `${conv._id}-${sha}`;

	const upload = collections.bucket.openUploadStream(filename, {
		metadata: { conversation: conv._id.toString(), model: tool?.model, mime: tool?.mime },
	});

	upload.write((await file.arrayBuffer()) as unknown as Buffer);
	upload.end();

	return filename;
}
