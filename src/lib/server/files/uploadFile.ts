import type { Conversation } from "$lib/types/Conversation";
import type { MessageFile } from "$lib/types/Message";
import { sha256 } from "$lib/utils/sha256";
import { collections } from "../database";

export async function uploadFile(file: File, conv: Conversation): Promise<MessageFile> {
	const sha = await sha256(await file.text());

	const upload = collections.bucket.openUploadStream(`${conv._id}-${sha}`, {
		metadata: { conversation: conv._id.toString(), mime: file.type },
	});

	upload.write((await file.arrayBuffer()) as unknown as Buffer);
	upload.end();

	// only return the filename when upload throws a finish event or a 20s time out occurs
	return new Promise((resolve, reject) => {
		upload.once("finish", () => resolve({ type: "hash", value: sha, mime: file.type }));
		upload.once("error", reject);
		setTimeout(() => reject(new Error("Upload timed out")), 20000);
	});
}
