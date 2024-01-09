import type { Conversation } from "$lib/types/Conversation";
import type { Tensor } from "@xenova/transformers";
import { sha256 } from "$lib/utils/sha256";
import { collections } from "../database";

export async function uploadImgFile(file: Blob, conv: Conversation): Promise<string> {
	const sha = await sha256(await file.text());

	const upload = collections.bucket.openUploadStream(`${conv._id}-${sha}`, {
		metadata: { conversation: conv._id.toString(), mime: "image/jpeg" },
	});

	upload.write((await file.arrayBuffer()) as unknown as Buffer);
	upload.end();

	// only return the filename when upload throws a finish event or a 10s time out occurs
	return new Promise((resolve, reject) => {
		upload.once("finish", () => resolve(sha));
		upload.once("error", reject);
		setTimeout(() => reject(new Error("Upload timed out")), 10000);
	});
}

export async function deleteFile(filename: string){
	// Step 1: Check if the file exists
	const existingFile = await collections.files.findOne({ filename });

	// Step 2: Delete the existing file if it exists
	if (existingFile) {
		await collections.bucket.delete(existingFile._id);
	}
}

export async function uploadPdfEmbeddings(
	embeddings: Tensor,
	textChunks: string[],
	conv: Conversation
): Promise<void> {
	const filename = `${conv._id}-pdf`;

	// Step 1: Delete the existing file if it exists
	await deleteFile(filename);

	// Step 2: Upload the new file
	const upload = collections.bucket.openUploadStream(filename, {
		metadata: { conversation: conv._id.toString(), textChunks, dims: embeddings.dims },
	});

	upload.write((await embeddings.data.buffer) as unknown as Buffer);
	upload.end();

	// only return the filename when upload throws a finish event or a 10s time out occurs
	return new Promise((resolve, reject) => {
		upload.once("finish", () => resolve());
		upload.once("error", reject);
		setTimeout(() => reject(new Error("Upload timed out")), 10000);
	});
}
