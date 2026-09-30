import { randomUUID } from "node:crypto";
import { applyUpdateToMessage } from "../applyUpdate";
import { compressUpdatesForStorage } from "../compressUpdates";
import type { Message } from "$lib/types/Message";
import {
	MessageElicitationUpdateType,
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
	/** what the calls emit while they run, a question for one */
	during?: (uuids: string[]) => MessageUpdate[];
	/** what follows the results, a plan card for one */
	after?: (uuids: string[]) => MessageUpdate[];
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
	events.push(...(round.during?.(uuids) ?? []));
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
	events.push(...(round.after?.(uuids) ?? []));
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

/** the conversion keeps the whitespace around a preamble, which the live loop stores trimmed */
export function preamblesTrimmed(message: Message): Message {
	return {
		...message,
		updates: message.updates?.map((update) => {
			if (update.type !== MessageUpdateType.Tool || update.subtype !== MessageToolUpdateType.Call) {
				return update;
			}
			const { content, ...call } = update;
			return content?.trim() ? { ...call, content: content.trim() } : call;
		}),
	};
}

export const ARTIFACT = '<artifact identifier="page" type="html" title="Page"><p>hi</p></artifact>';

const question = ([uuid]: string[]): MessageUpdate[] => [
	{
		type: MessageUpdateType.Elicitation,
		subtype: MessageElicitationUpdateType.Request,
		toolUuid: uuid,
		request: {
			elicitationId: `e-${uuid}`,
			source: "assistant",
			server: "",
			mode: "form",
			message: "",
			fields: [
				{
					kind: "select",
					name: "q1",
					title: "Storage",
					required: true,
					multiple: false,
					options: [{ value: "S3", label: "S3" }],
				},
			],
		},
	},
	{
		type: MessageUpdateType.Elicitation,
		subtype: MessageElicitationUpdateType.Resolved,
		elicitationId: `e-${uuid}`,
		action: "accept",
		resolution: "user",
		content: { q1: "S3" },
	},
];

const plan =
	(version: number) =>
	([uuid]: string[]): MessageUpdate[] => [
		{
			type: MessageUpdateType.Plan,
			uuid,
			goal: "Forecast",
			steps: [{ step: "Fetch", status: version > 1 ? "completed" : "in_progress" }],
			version,
		},
	];

const jobEnded = (uuids: string[]): MessageUpdate[] => [
	{
		type: MessageUpdateType.HarnessEvent,
		events: [
			{
				serviceId: "svc",
				kind: "job",
				jobId: "0123456789abcdef01234567",
				name: "sft-smoke",
				from: "RUNNING",
				to: "ERROR",
				ranSeconds: 137,
				at: 0,
			},
		],
		text: "[Harness event, not part of this tool result]\nJob sft-smoke failed: ERROR after 2m17s.",
		afterToolUuid: uuids[uuids.length - 1],
	},
];

export function convertingTurns(): Record<string, Message> {
	return {
		"plain answer with reasoning": assistantMessage(finalAnswer("Weighing it up.", "It is sunny.")),
		"rounds with reasoning and preambles": assistantMessage([
			...toolRound({ reasoning: "I need the weather.", text: "\n\nLet me check.\n\n" }),
			...toolRound({ reasoning: "Now the forecast.", tools: ["a", "b"] }),
			...toolRound({ text: "One more." }),
			...finalAnswer("I have it all.", "Sunny all week."),
		]),
		"runaway loop": assistantMessage([
			...Array.from({ length: 6 }, () =>
				toolRound({ reasoning: "Check again.", text: "Checking again." })
			).flat(),
			...finalAnswer("Still checking.", "Checking again."),
		]),
		"stopped mid-call": assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			...toolRound({ reasoning: "Again.", unfinished: true }),
		]),
		"stopped mid-call with the text so far": assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Let me check." }),
			...toolRound({ reasoning: "Again.", unfinished: true }),
			{
				type: MessageUpdateType.FinalAnswer,
				text: "<think>Plan.</think>Let me check.<think>Again.</think>",
				interrupted: true,
			},
		]),
		"artifact in a preamble": assistantMessage([
			...toolRound({ reasoning: `Draft it: ${ARTIFACT}`, text: `Here it is. ${ARTIFACT}` }),
			...finalAnswer("Done.", "Built the page."),
		]),
		"literal closer in a preamble": assistantMessage([
			...toolRound({ reasoning: "Plan.", text: "Closing </think> here." }),
			...finalAnswer(undefined, "Done."),
		]),
		"a question answered mid-turn": assistantMessage([
			...toolRound({ reasoning: "Ask first.", tools: ["ask_user_question"], during: question }),
			...toolRound({ reasoning: "They chose S3.", text: "Setting up S3." }),
			...finalAnswer(undefined, "Uploads go to S3."),
		]),
		"a job ended mid-turn": assistantMessage([
			...toolRound({ reasoning: "Write the eval.", text: "Writing it.", after: jobEnded }),
			...toolRound({ reasoning: "It failed, read the logs." }),
			...finalAnswer(undefined, "It ran out of memory."),
		]),
		"plan updates": assistantMessage([
			...toolRound({ reasoning: "Plan it.", tools: ["update_plan"], after: plan(1) }),
			...toolRound({ text: "Fetching." }),
			...toolRound({ reasoning: "Done.", tools: ["update_plan"], after: plan(2) }),
			...finalAnswer("Wrap up.", "Sunny."),
		]),
	};
}
