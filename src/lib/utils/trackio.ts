import type { Message } from "$lib/types/Message";
import type { MessageToolUpdate } from "$lib/types/MessageUpdate";
import { isMessageToolResultUpdate, isMessageToolUpdate } from "$lib/utils/messageUpdates";
import { ToolResultStatus } from "$lib/types/Tool";

/**
 * Trackio dashboards: a training run that calls `trackio.init(space_id=...)`
 * syncs its metrics to a Hugging Face Space, which serves a live dashboard for
 * the run. Trackio prints that Space's URL to stdout, so it reaches us through
 * the job tool's own output — already stored on the message as a tool result.
 *
 * The URL is therefore derived from TOOL OUTPUT, never from the model's prose.
 * That distinction is the whole point: a URL we frame inside chat-ui has to be
 * one a tool actually returned. The model is free to mention a dashboard in its
 * reply; that mention will not open a pane.
 *
 * Only `*.hf.space` is embeddable (see TrackioPane): Trackio on Spaces is the
 * default deployment, the origin is never chat-ui's own, and it keeps the
 * allowlist to a single host suffix we can reason about.
 */

/** Tools whose output may carry a dashboard URL: the ones that run user code. */
const TRACKIO_SOURCE_TOOLS = new Set(["hf_jobs", "hf_sandbox"]);

/** `https://<subdomain>.hf.space`, optionally with a path/query. */
const HF_SPACE_URL_REGEX = /https?:\/\/([a-z0-9][a-z0-9-]*)\.hf\.space(\/[^\s"'<>)\]}]*)?/gi;
/** The Hub-facing page for the same Space, which Trackio prints in some versions. */
const HF_SPACES_PAGE_REGEX = /https?:\/\/huggingface\.co\/spaces\/([A-Za-z0-9][\w.-]*)\/([\w.-]+)/g;

/** Log lines end in prose, so a URL at the end of a sentence keeps the period out. */
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?'"“”’)\]}]+$/;

export interface TrackioDashboard {
	/** Embeddable `https://<owner>-<name>.hf.space` URL. */
	url: string;
	/** Human label for the pane header: `owner/name` when known, else the subdomain. */
	label: string;
}

/**
 * A Space's subdomain is its `owner/name` lowercased with every run of
 * non-alphanumerics folded to a single dash, so `abidlabs/my_trackio` serves at
 * `abidlabs-my-trackio.hf.space`.
 */
export function spaceIdToEmbedOrigin(owner: string, name: string): string | undefined {
	const subdomain = `${owner}-${name}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!subdomain) return undefined;
	return `https://${subdomain}.hf.space`;
}

/**
 * Whether a URL found on this line is a Trackio dashboard rather than some
 * other Space the job happened to print. Two deterministic signals, either of
 * which is enough: the line names Trackio (which is how Trackio's own init
 * output reads), or the Space itself is named for it (`space_id="user/trackio"`
 * being the documented default).
 */
function isTrackioContext(line: string, spaceSlug: string): boolean {
	return /trackio/i.test(line) || /trackio/i.test(spaceSlug);
}

/** Strip a trailing sentence period etc. that the URL regex swallowed. */
function trimUrl(raw: string): string {
	return raw.replace(TRAILING_PUNCTUATION_REGEX, "");
}

/**
 * Scan raw tool output for Trackio dashboard URLs, in first-seen order.
 * Line-scoped on purpose: the Trackio marker and the URL have to appear
 * together, so an unrelated Space URL elsewhere in a long log is not adopted
 * just because the word "trackio" shows up somewhere in the same output.
 */
export function extractTrackioDashboards(text: string): TrackioDashboard[] {
	if (!text || !/trackio/i.test(text)) return [];
	const found: TrackioDashboard[] = [];
	const seen = new Set<string>();

	const push = (url: string, label: string) => {
		if (seen.has(url)) return;
		seen.add(url);
		found.push({ url, label });
	};

	for (const line of text.split(/\r?\n/)) {
		for (const match of line.matchAll(HF_SPACE_URL_REGEX)) {
			const subdomain = match[1].toLowerCase();
			if (!isTrackioContext(line, subdomain)) continue;
			// Re-parse rather than trusting the matched substring, so what we frame
			// is a URL the platform agrees on (and a userinfo-bearing lookalike like
			// `https://x.hf.space@evil.com` cannot reach the iframe).
			let parsed: URL;
			try {
				parsed = new URL(trimUrl(match[0]));
			} catch {
				continue;
			}
			if (parsed.username || parsed.password) continue;
			if (parsed.hostname.toLowerCase() !== `${subdomain}.hf.space`) continue;
			// Drop a bare root path, so the same dashboard printed in both forms
			// normalizes to one URL — dedupe and the auto-open key are the URL string.
			const path = parsed.pathname === "/" ? "" : parsed.pathname;
			push(`https://${parsed.hostname.toLowerCase()}${path}${parsed.search}`, subdomain);
		}

		for (const match of line.matchAll(HF_SPACES_PAGE_REGEX)) {
			const owner = match[1];
			const name = trimUrl(match[2]);
			if (!name) continue;
			const spaceId = `${owner}/${name}`;
			if (!isTrackioContext(line, spaceId)) continue;
			const origin = spaceIdToEmbedOrigin(owner, name);
			if (!origin) continue;
			push(origin, spaceId);
		}
	}

	return found;
}

/** Dashboards printed by one tool-call group's output. */
export function trackioDashboardsFromToolUpdates(updates: MessageToolUpdate[]): TrackioDashboard[] {
	const found: TrackioDashboard[] = [];
	const seen = new Set<string>();
	for (const update of updates) {
		if (!isMessageToolResultUpdate(update)) continue;
		const { result } = update;
		if (result.status !== ToolResultStatus.Success) continue;
		if (!TRACKIO_SOURCE_TOOLS.has(result.call.name)) continue;
		for (const output of result.outputs) {
			const text = output["text"];
			if (typeof text !== "string") continue;
			for (const dashboard of extractTrackioDashboards(text)) {
				if (seen.has(dashboard.url)) continue;
				seen.add(dashboard.url);
				found.push(dashboard);
			}
		}
	}
	return found;
}

/**
 * Every Trackio dashboard the visible conversation has produced, oldest first.
 * A pure function of the messages, like `collectArtifacts` — nothing is stored,
 * so reopening a conversation rebuilds the same list.
 */
export function collectTrackioDashboards(
	messages: Array<Pick<Message, "from" | "updates">>
): TrackioDashboard[] {
	const found: TrackioDashboard[] = [];
	const seen = new Set<string>();
	for (const message of messages) {
		if (message.from !== "assistant" || !message.updates?.length) continue;
		const toolUpdates = message.updates.filter(isMessageToolUpdate);
		if (!toolUpdates.length) continue;
		for (const dashboard of trackioDashboardsFromToolUpdates(toolUpdates)) {
			if (seen.has(dashboard.url)) continue;
			seen.add(dashboard.url);
			found.push(dashboard);
		}
	}
	return found;
}
