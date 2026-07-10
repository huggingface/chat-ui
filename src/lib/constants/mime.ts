// Centralized MIME allowlists used across client and server
// Keep these lists minimal and consistent with server processing.

export const TEXT_MIME_ALLOWLIST = [
	"text/*",
	"application/json",
	"application/xml",
	"application/csv",
] as const;

export const IMAGE_MIME_ALLOWLIST_DEFAULT = ["image/jpeg", "image/png"] as const;

// Document formats that are converted to text server-side before being sent to the model.
export const DOCUMENT_MIME_ALLOWLIST = ["application/pdf"] as const;

// Synthetic MIME type used for long pasted text turned into a pseudo-file client-side.
export const CLIPBOARD_MIME = "application/vnd.chatui.clipboard";
