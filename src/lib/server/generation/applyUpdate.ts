import {
	MessageReasoningUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";

export interface ApplyUpdateContext {
	/** The assistant message this turn writes into. Mutated in place. */
	message: Message;
	/** Mutated in place for title only; persisting it is the caller's job. */
	conv: Pick<Conversation, "title">;
	/**
	 * Content the message already had when the turn began. A resumed turn continues
	 * a message that is not empty, and the final answer replaces only what this turn
	 * produced — not what an earlier round of the same message already said.
	 */
	initialContent: string;
	/** Router models record route+model; everything else records provider alone. */
	isRouterModel: boolean;
}

export interface AppliedUpdate {
	/** An empty stream token is not an event: the caller must drop it entirely. */
	skipped: boolean;
	/** `conv.title` changed and wants persisting. */
	titleChanged: boolean;
	finalAnswerReceived: boolean;
}

const SKIPPED: AppliedUpdate = { skipped: true, titleChanged: false, finalAnswerReceived: false };

/**
 * Fold one update into the message a turn is building.
 *
 * Extracted from the conversation route so a turn woken by the sweeper persists
 * the same way a turn driven by an HTTP request does. Two implementations of this
 * would drift, and drift here means messages that persist subtly wrong — the
 * pre-tool merge below is exactly the kind of hard-won rule that gets lost.
 *
 * Deliberately does no I/O: the title write, the generation writer, metrics, the
 * wire padding and the SSE enqueue all stay with their callers, because those
 * differ between an HTTP turn and a swept one.
 */
export function applyUpdateToMessage(
	event: MessageUpdate,
	{ message, conv, initialContent, isRouterModel }: ApplyUpdateContext
): AppliedUpdate {
	let titleChanged = false;
	let finalAnswerReceived = false;

	if (event.type === MessageUpdateType.Stream) {
		if (event.token === "") return SKIPPED;
		message.content += event.token;
	} else if (
		event.type === MessageUpdateType.Reasoning &&
		event.subtype === MessageReasoningUpdateType.Stream &&
		"token" in event
	) {
		message.reasoning ??= "";
		message.reasoning += event.token;
	} else if (event.type === MessageUpdateType.Title) {
		// A reasoning model will put think markers in a title if nothing removes them.
		conv.title = event.title.replace(/<\/?think>/gi, "").trim();
		titleChanged = true;
	} else if (event.type === MessageUpdateType.FinalAnswer) {
		message.interrupted = event.interrupted;
		// Default behavior: replace the streamed text with the provider's final text.
		// However, when tools (MCP/function calls) were used, providers often stream
		// some content (e.g., a story) before triggering tools, then return a
		// different follow-up message afterwards (e.g., an image caption). Our
		// previous logic overwrote the pre-tool content. Preserve it by merging in
		// the pre-tool stream when tool updates occurred and the final text does
		// not already include the streamed prefix.
		const hadTools = (message.updates ?? []).some((u) => u.type === MessageUpdateType.Tool);

		if (hadTools) {
			const existing = message.content.slice(initialContent.length);
			if (existing && existing.length > 0) {
				// A. If we already streamed the same final text, keep as-is.
				if (event.text && existing.endsWith(event.text)) {
					message.content = initialContent + existing;
				}
				// B. If the final text already includes the streamed prefix, use it verbatim.
				else if (event.text && event.text.startsWith(existing)) {
					message.content = initialContent + event.text;
				}
				// C. Otherwise, merge with a paragraph break for readability.
				else {
					const needsGap = !/\n\n$/.test(existing) && !/^\n/.test(event.text ?? "");
					message.content =
						initialContent + existing + (needsGap ? "\n\n" : "") + (event.text ?? "");
				}
			} else {
				message.content = initialContent + (event.text ?? "");
			}
		} else {
			message.content = initialContent + event.text;
		}
		finalAnswerReceived = true;
	} else if (event.type === MessageUpdateType.File) {
		message.files = [
			...(message.files ?? []),
			{ type: "hash", name: event.name, value: event.sha, mime: event.mime },
		];
	} else if (event.type === MessageUpdateType.RouterMetadata) {
		// Merge metadata updates to preserve existing fields (router may send route/model
		// first, then provider comes later)
		if (isRouterModel) {
			message.routerMetadata = {
				route: event.route || message.routerMetadata?.route || "",
				model: event.model || message.routerMetadata?.model || "",
				provider: event.provider || message.routerMetadata?.provider,
			};
		} else if (event.provider) {
			message.routerMetadata = {
				route: message.routerMetadata?.route || "",
				model: message.routerMetadata?.model || "",
				provider: event.provider,
			};
		}
	}

	// Append updates for audit/replay (streams too, to preserve ordering)
	if (!(
		event.type === MessageUpdateType.Status && event.status === MessageUpdateStatus.KeepAlive
	)) {
		message.updates ??= [];
		message.updates.push(event.type === MessageUpdateType.Stream ? { ...event } : event);
	}

	message.updatedAt = new Date();

	return { skipped: false, titleChanged, finalAnswerReceived };
}
