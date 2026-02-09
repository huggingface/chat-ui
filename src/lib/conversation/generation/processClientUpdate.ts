import type { Message } from "$lib/types/Message";
import {
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { mergeFinalAnswer } from "./mergeFinalAnswer";
import { mergeRouterMetadata } from "./mergeRouterMetadata";

export type ProcessClientUpdateInput = {
	message: Message;
	update: MessageUpdate;
	disableStream: boolean;
	buffer: string;
	lastUpdateTime: Date;
	maxUpdateTimeMs: number;
	now?: Date;
};

export type ProcessClientUpdateResult = {
	message: Message;
	buffer: string;
	lastUpdateTime: Date;
	effects: {
		setPendingFalse: boolean;
		errorMessage?: string;
		showSubscribeModal: boolean;
		title?: string;
	};
};

function sanitizeUpdate(update: MessageUpdate): MessageUpdate {
	if (update.type !== MessageUpdateType.Stream) {
		return update;
	}

	return {
		...update,
		token: update.token.replaceAll("\0", ""),
	};
}

export function processClientUpdate({
	message,
	update,
	disableStream,
	buffer,
	lastUpdateTime,
	maxUpdateTimeMs,
	now = new Date(),
}: ProcessClientUpdateInput): ProcessClientUpdateResult {
	const normalizedUpdate = sanitizeUpdate(update);
	let nextUpdates = [...(message.updates ?? [])];
	const nextMessage: Message = {
		...message,
		content: message.content,
		updates: nextUpdates,
		files: message.files ? [...message.files] : undefined,
	};

	let nextBuffer = buffer;
	let nextLastUpdateTime = lastUpdateTime;

	const effects: ProcessClientUpdateResult["effects"] = {
		setPendingFalse: false,
		showSubscribeModal: false,
	};

	const isKeepAlive =
		normalizedUpdate.type === MessageUpdateType.Status &&
		normalizedUpdate.status === MessageUpdateStatus.KeepAlive;

	if (!isKeepAlive) {
		if (normalizedUpdate.type === MessageUpdateType.Stream) {
			const lastUpdate = nextUpdates.at(-1);

			if (lastUpdate?.type === MessageUpdateType.Stream) {
				const mergedStreamUpdate = {
					...lastUpdate,
					token: lastUpdate.token + normalizedUpdate.token,
				};

				nextUpdates = [...nextUpdates.slice(0, -1), mergedStreamUpdate];
			} else {
				nextUpdates = [...nextUpdates, normalizedUpdate];
			}
		} else {
			nextUpdates = [...nextUpdates, normalizedUpdate];
		}
		nextMessage.updates = nextUpdates;
	}

	if (
		normalizedUpdate.type !== MessageUpdateType.Stream &&
		!disableStream &&
		nextBuffer.length > 0
	) {
		nextMessage.content += nextBuffer;
		nextBuffer = "";
		nextLastUpdateTime = now;
	}

	if (normalizedUpdate.type === MessageUpdateType.Stream && !disableStream) {
		nextBuffer += normalizedUpdate.token;

		if (now.getTime() - nextLastUpdateTime.getTime() > maxUpdateTimeMs) {
			nextMessage.content += nextBuffer;
			nextBuffer = "";
			nextLastUpdateTime = now;
		}

		effects.setPendingFalse = true;
	} else if (normalizedUpdate.type === MessageUpdateType.FinalAnswer) {
		const hadTools = nextUpdates.some(
			(messageUpdate) => messageUpdate.type === MessageUpdateType.Tool
		);

		nextMessage.content = mergeFinalAnswer({
			currentContent: nextMessage.content,
			finalText: normalizedUpdate.text,
			interrupted: normalizedUpdate.interrupted,
			hadTools,
		});
	} else if (
		normalizedUpdate.type === MessageUpdateType.Status &&
		normalizedUpdate.status === MessageUpdateStatus.Error
	) {
		if (normalizedUpdate.statusCode === 402) {
			effects.showSubscribeModal = true;
		} else {
			effects.errorMessage = normalizedUpdate.message ?? "An error has occurred";
		}
	} else if (normalizedUpdate.type === MessageUpdateType.Title) {
		effects.title = normalizedUpdate.title;
	} else if (normalizedUpdate.type === MessageUpdateType.File) {
		nextMessage.files = [
			...(nextMessage.files ?? []),
			{
				type: "hash",
				value: normalizedUpdate.sha,
				mime: normalizedUpdate.mime,
				name: normalizedUpdate.name,
			},
		];
	} else if (normalizedUpdate.type === MessageUpdateType.RouterMetadata) {
		nextMessage.routerMetadata = mergeRouterMetadata(nextMessage.routerMetadata, normalizedUpdate);
	}

	return {
		message: nextMessage,
		buffer: nextBuffer,
		lastUpdateTime: nextLastUpdateTime,
		effects,
	};
}
