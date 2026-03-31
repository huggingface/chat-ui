import { env as publicEnv } from "$env/dynamic/public";

// Centralized MIME allowlists used across client and server
// Keep these lists minimal and consistent with server processing.
const TEXT_MIME_ALLOWLIST_DEFAULT = [
	"text/*",
	"application/json",
	"application/xml",
	"application/csv",
] as const;

export function parseTextMimeAllowlist(value: string | undefined): string[] {
	if (!value?.trim()) {
		return [...TEXT_MIME_ALLOWLIST_DEFAULT];
	}

	const custom = Array.from(
		new Set(
			value
				.split(",")
				.map((mime) => mime.trim().toLowerCase())
				.filter(Boolean)
		)
	);

	return custom.length > 0 ? custom : [...TEXT_MIME_ALLOWLIST_DEFAULT];
}

export const TEXT_MIME_ALLOWLIST = parseTextMimeAllowlist(publicEnv.PUBLIC_TEXT_MIME_ALLOWLIST);

export const IMAGE_MIME_ALLOWLIST_DEFAULT = ["image/jpeg", "image/png"] as const;
