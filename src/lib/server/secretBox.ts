import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { logger } from "$lib/server/logger";

// unprefixed values pass through as legacy plaintext
const ENC_PREFIX = "enc.v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SecretBox {
	hasKey(): boolean;
	encrypt(plaintext: string): string;
	/** returns an empty string for a value encrypted under a missing or different key */
	decrypt(value: string): string;
}

/** aes-256-gcm keyed by readKey, values are stored as plaintext without a key */
export function createSecretBox(
	readKey: () => string | undefined,
	noKeyWarning: string
): SecretBox {
	// undefined until resolved, null when no key is configured
	let cachedKey: Buffer | null | undefined;
	let warnedNoKey = false;

	function getKey(): Buffer | null {
		if (cachedKey !== undefined) return cachedKey;
		const raw = (readKey() ?? "").trim();
		if (!raw) {
			cachedKey = null;
			if (!warnedNoKey) {
				warnedNoKey = true;
				logger.warn(noKeyWarning);
			}
			return null;
		}
		cachedKey = createHash("sha256").update(raw).digest();
		return cachedKey;
	}

	return {
		hasKey: () => getKey() !== null,
		encrypt(plaintext) {
			const key = getKey();
			if (!key) return plaintext;
			const iv = randomBytes(IV_BYTES);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
			const tag = cipher.getAuthTag();
			return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
		},
		decrypt(value) {
			if (!value.startsWith(ENC_PREFIX)) return value;
			const key = getKey();
			if (!key) return "";
			try {
				const raw = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
				const iv = raw.subarray(0, IV_BYTES);
				const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
				const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
				const decipher = createDecipheriv("aes-256-gcm", key, iv);
				decipher.setAuthTag(tag);
				return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
			} catch {
				return "";
			}
		},
	};
}
