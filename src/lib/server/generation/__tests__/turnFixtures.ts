import { randomUUID } from "node:crypto";
import { applyUpdateToMessage } from "../applyUpdate";
import { compressUpdatesForStorage } from "../compressUpdates";
import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import type { TurnStatus } from "$lib/types/TurnState";

export const stream = (token: string): MessageUpdate => ({ type: MessageUpdateType.Stream, token });

/** shaped like the runMcpFlow stream, the closing tag rides on the first content delta */
export function streamed(reasoning: string | undefined, text: string | undefined): MessageUpdate[] {
	if (!reasoning) return text ? [stream(text)] : [];
	return [stream(`<think>${reasoning}`), stream(`</think>${text ?? ""}`)];
}

export interface FixtureRound {
	reasoning?: string;
	text?: string;
	tools?: string[];
	/** what the first call records when not what streamed, trimmed like toolInvocation stores it */
	stored?: { reasoning?: string; content?: string };
	/** record neither field, like calls stored before rounds kept their text */
	storesNothing?: boolean;
	/** the last call never recorded an outcome */
	unfinished?: boolean;
}

export function toolRound(round: FixtureRound): MessageUpdate[] {
	const reasoning = round.stored ? round.stored.reasoning : round.reasoning;
	const content = round.stored ? round.stored.content : round.text?.trim();
	const tools = round.tools ?? ["get_weather"];
	const uuids = tools.map(() => randomUUID());
	const events: MessageUpdate[] = [...streamed(round.reasoning, round.text)];
	for (const [index, name] of tools.entries()) {
		events.push({
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Call,
			uuid: uuids[index],
			call: { name, parameters: { city: "Paris" } },
			argumentsRaw: '{"city":"Paris"}',
			...(index === 0 && !round.storesNothing && reasoning?.trim() ? { reasoning } : {}),
			...(index === 0 && !round.storesNothing && content?.trim() ? { content } : {}),
		});
		events.push({
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.ETA,
			uuid: uuids[index],
			eta: 10,
		});
	}
	for (const [index, name] of tools.entries()) {
		if (round.unfinished && index === tools.length - 1) break;
		events.push({
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Result,
			uuid: uuids[index],
			result: {
				status: ToolResultStatus.Success,
				call: { name, parameters: { city: "Paris" } },
				outputs: [{ text: `${name}: 18°C` }],
				display: true,
			},
		});
	}
	return events;
}

/** the final completion, then a FinalAnswer carrying its whole text as runMcpFlow sends it */
export function finalAnswer(
	reasoning: string | undefined,
	text: string,
	opts: { interrupted?: boolean } = {}
): MessageUpdate[] {
	const tokens = streamed(reasoning, text);
	return [
		...tokens,
		{
			type: MessageUpdateType.FinalAnswer,
			text: tokens.map((t) => (t.type === MessageUpdateType.Stream ? t.token : "")).join(""),
			interrupted: opts.interrupted ?? false,
		},
	];
}

/** both legacy ends predate turn states, legacyPark was stamped finished on a park */
export type FixtureEnd = TurnStatus | "legacy" | "legacyPark";

/** built like a real turn so content and stream markers line up as in storage */
export function assistantMessage(events: MessageUpdate[], end: FixtureEnd = "done"): Message {
	const message: Message = {
		id: randomUUID(),
		from: "assistant",
		content: "",
		updates: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const legacy = end === "legacy" || end === "legacyPark";
	const lifecycle = (state: TurnStatus): MessageUpdate[] =>
		legacy ? [] : [{ type: MessageUpdateType.TurnState, state, serverNow: Date.now() }];
	const all: MessageUpdate[] = [
		...lifecycle("running"),
		{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Started },
		...events,
		...(end === "running"
			? []
			: [{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished } as const]),
		...(legacy || end === "running" ? [] : lifecycle(end)),
	];
	const conv = { title: "t" };
	for (const event of all) {
		applyUpdateToMessage(event, { message, conv, initialContent: "", isRouterModel: false });
	}
	return { ...message, updates: compressUpdatesForStorage(message.updates) };
}
