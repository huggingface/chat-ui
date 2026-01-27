// Centralized MIME allowlists used across client and server
// Keep these lists minimal and consistent with server processing.

export const TEXT_MIME_ALLOWLIST = [
	"text/*",
	"application/json",
	"application/xml",
	"application/csv",
] as const;

// Binary documents that the backend can extract text from
// These are passed as base64 to the LLM endpoint for server-side processing
export const BINARY_DOC_ALLOWLIST = [
	"application/pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
	"application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
	"application/msword", // .doc
	"application/vnd.ms-excel", // .xls
	"application/vnd.ms-powerpoint", // .ppt
	"application/rtf",
	"application/epub+zip",
] as const;

export const IMAGE_MIME_ALLOWLIST_DEFAULT = ["image/jpeg", "image/png"] as const;
