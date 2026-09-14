import { parseExternalUrl } from "./externalLink";
import { sanitizeUrlParam } from "./urlParams";

/**
 * What a deep link into the home or model route asked for. Read once on
 * mount, held in memory, never persisted: the URL is stripped of these
 * params as soon as they are read so a reload or Back cannot replay them.
 */
export interface LinkPromptRequest {
	/** Text from `q` or `prompt`; `q` wins when both are present. */
	prompt: string | null;
	/**
	 * Attachments the link asked to load, in link order and deduplicated. Only
	 * absolute http(s) URLs without credentials survive parsing; anything else
	 * could never be fetched and is dropped.
	 */
	attachmentUrls: URL[];
	/** Whether the link asked for the prompt to be sent (`q`) rather than prefilled (`prompt`). */
	send: boolean;
}

export const LINK_PARAM_NAMES = ["q", "prompt", "attachments"] as const;

/**
 * Attachment sources that need no confirmation: content Hugging Face itself
 * publishes, matched by path prefix. The Hub's "Ask HuggingChat" boxes and
 * the docs "Copy page" menu attach a docs page as markdown, a per-library
 * skill prompt, and the paper markdown from the papers bucket.
 *
 * A host is not enough: user repos live on the same host and anyone can
 * upload a file to one, so every entry names a path prefix. arXiv is left
 * out on purpose — no producer links it, and anyone can publish there.
 */
const TRUSTED_ATTACHMENT_PATH_PREFIXES = [
	"/docs/",
	"/buckets/huggingchat/papers-content/resolve/",
	"/buckets/huggingchat/docs-chat/resolve/",
];
const TRUSTED_ATTACHMENT_HOSTS = new Set(["huggingface.co", "hf.co"]);

export function isTrustedAttachmentUrl(url: URL): boolean {
	if (url.protocol !== "https:") return false;
	if (url.username || url.password) return false;
	// A non-default port would be a different service on the same name.
	if (url.port !== "") return false;
	if (!TRUSTED_ATTACHMENT_HOSTS.has(url.hostname.toLowerCase())) return false;
	// `URL` has already resolved dot segments, percent-encoded ones included,
	// so a prefix test on the pathname cannot be escaped with `..`.
	return TRUSTED_ATTACHMENT_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

/**
 * Parse `?attachments=`: comma-separated in one param, repeated params, or
 * both.
 */
function parseAttachmentUrls(params: URLSearchParams): URL[] {
	const seen = new Set<string>();
	const urls: URL[] = [];
	for (const param of params.getAll("attachments")) {
		for (const raw of param.split(",")) {
			const url = parseExternalUrl(raw.trim());
			if (!url || seen.has(url.href)) continue;
			seen.add(url.href);
			urls.push(url);
		}
	}
	return urls;
}

/** `null` when the URL carries nothing for the composer. */
export function readLinkPromptRequest(params: URLSearchParams): LinkPromptRequest | null {
	const q = sanitizeUrlParam(params.get("q"));
	const prompt = q ?? sanitizeUrlParam(params.get("prompt"));
	const attachmentUrls = parseAttachmentUrls(params);
	if (!prompt && attachmentUrls.length === 0) return null;
	return { prompt, attachmentUrls, send: q !== null };
}

/**
 * Whether the link needs the user's say-so before anything is fetched or
 * sent: one that asks to send, or one that brings content from somewhere we
 * do not publish ourselves. A `prompt` link with trusted attachments only
 * prefills, and the user still presses send, so it goes straight through.
 */
export function linkPromptNeedsConfirmation(request: LinkPromptRequest): boolean {
	return request.send || request.attachmentUrls.some((url) => !isTrustedAttachmentUrl(url));
}
