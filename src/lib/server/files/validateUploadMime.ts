import {
	TEXT_MIME_ALLOWLIST,
	DOCUMENT_MIME_ALLOWLIST,
	IMAGE_MIME_ALLOWLIST_DEFAULT,
	CLIPBOARD_MIME,
} from "$lib/constants/mime";
import { mimeMatchesAllowlist } from "$lib/utils/mime";

// Images are always allowed regardless of model.multimodal: users can
// force-enable multimodal per model via settings.multimodalOverrides.
export function isAllowedUploadMime(
	mime: string,
	modelAcceptedMimetypes?: readonly string[]
): boolean {
	// Browsers report an empty type for files with unknown extensions (e.g. via the
	// "All Files" picker). Let those through: this check is defense-in-depth on the
	// client-declared mime, and content-level truth is the file-type sniff in uploadFile.
	if (!mime) {
		return true;
	}
	const allowlist = [
		...TEXT_MIME_ALLOWLIST,
		...DOCUMENT_MIME_ALLOWLIST,
		...IMAGE_MIME_ALLOWLIST_DEFAULT,
		...(modelAcceptedMimetypes ?? []),
		CLIPBOARD_MIME,
	];
	return mimeMatchesAllowlist(mime, allowlist);
}
