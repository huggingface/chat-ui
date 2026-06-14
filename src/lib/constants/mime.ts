import { env as publicEnv } from "$env/dynamic/public";

// Centralized MIME allowlists used across client and server
// Keep these lists minimal and consistent with server processing.

export const TEXT_MIME_ALLOWLIST = [
	"text/*",
	"application/json",
	"application/xml",
	"application/csv",
] as const;

export const IMAGE_MIME_ALLOWLIST_DEFAULT = ["image/jpeg", "image/png"] as const;

// Allows deployments to accept additional text-like MIME types (e.g. "application/typescript")
// via a comma-separated PUBLIC_TEXT_MIME_ALLOWLIST_EXTRA env var.
export function getTextMimeAllowlist(): readonly string[] {
	const extra =
		publicEnv.PUBLIC_TEXT_MIME_ALLOWLIST_EXTRA?.split(",")
			.map((mime) => mime.trim())
			.filter(Boolean) ?? [];

	return [...TEXT_MIME_ALLOWLIST, ...extra];
}
