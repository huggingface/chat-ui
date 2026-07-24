import {
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageStatusUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { Message } from "$lib/types/Message";
import type { StreamingMode } from "$lib/types/Settings";
import { mergeFinalAnswerContent } from "./mergeFinalAnswer";

export interface ConsumeContext {
	streamingMode: StreamingMode;
	/** In raw mode, how long content may buffer before a flush (ms). */
	maxUpdateTime: number;
	isAborted: () => boolean;
	onAbort: () => void;
	/** Fired on every stream token; the caller uses it to clear its `pending` flag once. */
	onStreamStart: () => void;
	onTitle: (title: string) => void;
	onError: (update: MessageStatusUpdate) => void;
}

/**
 * Apply a stream of MessageUpdates to the reactive $state `message` the UI renders.
 * Shared by the two ways updates arrive — the POST that starts a run and the reattach
 * stream that resumes one — so both render identically from one copy of the rules.
 */
export async function consumeMessageUpdates(
	iterator: AsyncGenerator<MessageUpdate>,
	message: Message,
	ctx: ConsumeContext
): Promise<void> {
	let buffer = "";
	let lastUpdateTime = new Date();
	let frameFlushScheduled = false;

	// Local authoritative copy of message.updates during streaming. Assigning the
	// reactive field on every chunk re-triggers the full markdown derivation; buffer
	// here and flush on the same cadence as content. Readers below must use the
	// buffer, not message.updates, or they see stale data between flushes.
	let updatesBuffer: MessageUpdate[] = message.updates ?? [];
	let updatesDirty = false;

	const flushBuffer = (currentTime: Date) => {
		if (buffer.length === 0 && !updatesDirty) return;
		if (buffer.length > 0) {
			message.content += buffer;
			buffer = "";
			lastUpdateTime = currentTime;
		}
		if (updatesDirty) {
			message.updates = updatesBuffer;
			updatesDirty = false;
		}
	};

	const scheduleFrameFlush = () => {
		if (frameFlushScheduled) return;
		frameFlushScheduled = true;
		const flush = () => {
			frameFlushScheduled = false;
			flushBuffer(new Date());
		};
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(flush);
		} else {
			setTimeout(flush, 0);
		}
	};

	for await (const update of iterator) {
		if (ctx.isAborted()) {
			// Commit anything still buffered: the navigation-abort path skips the
			// post-stream refresh, so a dropped buffer would be lost from the UI.
			flushBuffer(new Date());
			ctx.onAbort();
			return;
		}

		// Remove null padding added server-side (see the keylogging note there).
		if (update.type === MessageUpdateType.Stream) {
			update.token = update.token.replaceAll("\0", "");
		}

		const isKeepAlive =
			update.type === MessageUpdateType.Status && update.status === MessageUpdateStatus.KeepAlive;

		if (!isKeepAlive) {
			if (update.type === MessageUpdateType.Stream) {
				const lastUpdate = updatesBuffer.at(-1);
				if (lastUpdate?.type === MessageUpdateType.Stream) {
					// Fresh objects/arrays so the UI reacts to merged tokens.
					const merged = {
						...lastUpdate,
						token: (lastUpdate.token ?? "") + (update.token ?? ""),
					};
					updatesBuffer = [...updatesBuffer.slice(0, -1), merged];
				} else {
					updatesBuffer = [...updatesBuffer, update];
				}
			} else {
				updatesBuffer = [...updatesBuffer, update];
			}
			updatesDirty = true;
		}

		const currentTime = new Date();

		// A non-stream update flushes buffered tokens so the UI doesn't appear to cut
		// mid-sentence while tools run or the final answer arrives.
		if (update.type !== MessageUpdateType.Stream) {
			flushBuffer(currentTime);
		}

		if (update.type === MessageUpdateType.Stream) {
			buffer += update.token;
			if (ctx.streamingMode === "smooth") {
				scheduleFrameFlush();
			} else if (currentTime.getTime() - lastUpdateTime.getTime() > ctx.maxUpdateTime) {
				flushBuffer(currentTime);
			}
			ctx.onStreamStart();
		} else if (update.type === MessageUpdateType.FinalAnswer) {
			message.content = mergeFinalAnswerContent({
				existing: message.content,
				finalText: update.text ?? "",
				hadTools: updatesBuffer.some((u) => u.type === MessageUpdateType.Tool),
				isInterrupted: update.interrupted === true,
			});
		} else if (
			update.type === MessageUpdateType.Status &&
			update.status === MessageUpdateStatus.Error
		) {
			ctx.onError(update);
		} else if (update.type === MessageUpdateType.Title) {
			ctx.onTitle(update.title);
		} else if (update.type === MessageUpdateType.File) {
			message.files = [
				...(message.files ?? []),
				{ type: "hash", value: update.sha, mime: update.mime, name: update.name },
			];
		} else if (update.type === MessageUpdateType.RouterMetadata) {
			message.routerMetadata = { route: update.route, model: update.model };
		}
	}

	flushBuffer(new Date());
}
