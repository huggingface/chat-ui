import * as crypto from "crypto";

export async function sha256(input: string): Promise<string> {
	const utf8 = new TextEncoder().encode(input);
	const hashBuffer = await crypto.subtle.digest("SHA-256", utf8);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((bytes) => bytes.toString(16).padStart(2, "0")).join("");
	return hashHex;
}

export function instantSha256(input: string | Buffer): string {
	const sha256Stream = crypto.createHash("sha256");
	sha256Stream.update(input);
	return sha256Stream.digest().toString("hex");
}
