// Centralized MIME allowlists used across client and server
// Keep these lists minimal and consistent with server processing.
import { env as publicEnv } from "$env/dynamic/public";

export const TEXT_MIME_ALLOWLIST_DEFAULT = [
	"text/*",
	"application/json",
	"application/xml",
	"application/csv",
] as const;

export const IMAGE_MIME_ALLOWLIST_DEFAULT = ["image/jpeg", "image/png"] as const;

// Allows self-hosted deployments to extend the default text MIME allowlist without
// forking the code, e.g. PUBLIC_TEXT_MIME_ALLOWLIST="text/x-typescript,text/x-python"
function parseExtraMimeTypes(value: string | undefined): string[] {
	if (!value) return [];
	// Lowercased so the client matcher, which compares case-sensitively, agrees
	// with the server's own lowercasing. MIME types are case-insensitive.
	return value
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

const extraTextMimeTypes = parseExtraMimeTypes(publicEnv.PUBLIC_TEXT_MIME_ALLOWLIST);

export const TEXT_MIME_ALLOWLIST: readonly string[] = extraTextMimeTypes.length
	? [...TEXT_MIME_ALLOWLIST_DEFAULT, ...extraTextMimeTypes]
	: TEXT_MIME_ALLOWLIST_DEFAULT;
