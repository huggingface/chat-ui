import { error } from "@sveltejs/kit";
import { Database } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import type { SharedConversation } from "$lib/types/SharedConversation";

export async function downloadFile(
	sha256: string,
	convId: Conversation["_id"] | SharedConversation["_id"]
) {
	const fileId = Database.getInstance().getCollections().bucket.find({ filename: `${convId.toString()}-${sha256}` });
	let mime = "";

	const content = await fileId.next().then(async (file) => {
		if (!file) {
			throw error(404, "File not found");
		}
		if (file.metadata?.conversation !== convId.toString()) {
			throw error(403, "You don't have access to this file.");
		}

		mime = file.metadata?.mime;

		const fileStream = Database.getInstance().getCollections().bucket.openDownloadStream(file._id);

		const fileBuffer = await new Promise<Buffer>((resolve, reject) => {
			const chunks: Uint8Array[] = [];
			fileStream.on("data", (chunk) => chunks.push(chunk));
			fileStream.on("error", reject);
			fileStream.on("end", () => resolve(Buffer.concat(chunks)));
		});

		return fileBuffer;
	});

	return { content, mime };
}
