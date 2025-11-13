import { storage } from "./indexedDB";
import type { MessageFile } from "$lib/types/Message";
import { sha256 } from "$lib/utils/sha256";
import { fileTypeFromBuffer } from "file-type";

export async function uploadFile(file: File, conversationId: string): Promise<MessageFile> {
	const sha = await sha256(await file.text());
	const buffer = await file.arrayBuffer();

	// Attempt to detect the mime type of the file, fallback to the uploaded mime
	const mime = await fileTypeFromBuffer(buffer).then((fileType) => fileType?.mime ?? file.type);

	await storage.saveFile(file, conversationId, sha);

	return { type: "hash", value: sha, mime: file.type, name: file.name };
}

export async function downloadFile(
	hash: string,
	conversationId: string
): Promise<MessageFile & { type: "base64" }> {
	const storedFile = await storage.getFile(hash, conversationId);

	if (!storedFile) {
		throw new Error("File not found");
	}

	const buffer = await storedFile.data.arrayBuffer();
	// Convert ArrayBuffer to base64 in browser-compatible way
	const bytes = new Uint8Array(buffer);
	const binary = bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), "");
	const base64 = btoa(binary);

	return {
		type: "base64",
		name: storedFile.name,
		value: base64,
		mime: storedFile.mime,
	};
}

