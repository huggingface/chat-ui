import type { Message } from "$lib/types/Message";
import { isMessageToolResultUpdate, isMessageToolUpdate } from "$lib/utils/messageUpdates";
import { ToolResultStatus } from "$lib/types/Tool";

/**
 * Live Space previews: a `*.hf.space` app a tool announced on a `Preview: <url>` line of its own
 * output (see `previewLine`), framed in the side pane (see SpacePreviewPane). Like Trackio
 * dashboards the URL comes from TOOL OUTPUT only, and only from the tools the caller trusts —
 * ones whose output chat-ui writes itself — so a URL the model mentions in prose never gets framed.
 */

/** the line a tool prints to announce a preview, for `collectSpacePreviews` to find */
export function previewLine(host: string): string {
	return `Preview: https://${host}/`;
}

const PREVIEW_LINE = /^Preview:\s*(https:\/\/[a-z0-9][a-z0-9-]*\.hf\.space\/?)\s*$/im;

export interface SpacePreview {
	/** `https://<subdomain>.hf.space/` */
	url: string;
	/** the subdomain, for the pane header */
	label: string;
	/** message the preview was announced in, to order it among the pane items */
	messageId?: Message["id"];
}

/** Every Space preview `sourceTools` announced on the visible path, oldest first, one per URL. */
export function collectSpacePreviews(
	messages: Array<Pick<Message, "id" | "from" | "updates">>,
	sourceTools: readonly string[]
): SpacePreview[] {
	if (sourceTools.length === 0) return [];
	const found = new Map<string, SpacePreview>();
	for (const message of messages) {
		if (message.from !== "assistant" || !message.updates?.length) continue;
		for (const update of message.updates.filter(isMessageToolUpdate)) {
			if (!isMessageToolResultUpdate(update)) continue;
			const { result } = update;
			if (result.status !== ToolResultStatus.Success) continue;
			if (!sourceTools.includes(result.call.name)) continue;
			for (const output of result.outputs) {
				const text = output["text"];
				const match = typeof text === "string" ? PREVIEW_LINE.exec(text) : null;
				if (!match) continue;
				// re-parsed so userinfo or a lookalike host can never reach the iframe
				const url = new URL(match[1]);
				if (url.username || url.password || !url.hostname.endsWith(".hf.space")) continue;
				const href = `https://${url.hostname}/`;
				if (!found.has(href)) {
					found.set(href, {
						url: href,
						label: url.hostname.replace(/\.hf\.space$/, ""),
						messageId: message.id,
					});
				}
			}
		}
	}
	return [...found.values()];
}
