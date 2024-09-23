import crypto from "crypto";
import { env } from "$env/dynamic/private";

if (!env.ENCRYPTION_KEY) {
	throw new Error(
		"Encryption key is not set, please set the ENCRYPTION_KEY environment variable inside .env.local"
	);
}

const algorithm = "aes-256-cbc";
const key = crypto.scryptSync(env.ENCRYPTION_KEY, "salt", 32);

export function encrypt(text: string): string {
	try {
		const iv = crypto.randomBytes(16);
		const cipher = crypto.createCipheriv(algorithm, key, iv);
		const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
		return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
	} catch (error) {
		console.error("Encryption failed:", error);
		throw new Error("Encryption failed");
	}
}

export function decrypt(text: string): string {
	try {
		const [ivHex, encryptedHex] = text.split(":");
		const iv = Buffer.from(ivHex, "hex");
		const encryptedText = Buffer.from(encryptedHex, "hex");
		const decipher = crypto.createDecipheriv(algorithm, key, iv);
		const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
		return decrypted.toString("utf8");
	} catch (error) {
		console.error("Decryption failed:", error);
		throw new Error("Decryption failed");
	}
}
