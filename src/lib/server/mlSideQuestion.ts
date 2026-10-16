import type { OpenAI } from "openai";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { models } from "$lib/server/models";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { mlAssistantModelEntry } from "$lib/server/mlAssistantModels";
import { requestProvider } from "$lib/server/requestProvider";
import { isTurnAlive } from "$lib/server/generation/turnLog";
import type { makeImageProcessor } from "$lib/server/endpoints/images";
import { prepareHistory } from "$lib/server/textGeneration/utils/prepareFiles";
import { historyWindowEnabled } from "$lib/server/textGeneration/utils/historyWindowFlag";
import {
	planWindow,
	renderWindow,
	windowLimitChars,
	type HistoryUnit,
} from "$lib/server/textGeneration/utils/historyWindow";
import { buildSubtree } from "$lib/utils/tree/buildSubtree";
import { stripThink } from "$lib/utils/stripThink";

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export const SIDE_QUESTION_MAX_CHARS = 4_000;

const MAX_ANSWER_TOKENS = 4_096;

export const SIDE_QUESTION_PROMPT = `You answer a side question about an ML Intern run, asked by the user while the run carries on independently.
- You only see the transcript below, as stored a few seconds ago. You cannot call tools, change the run, or send anything to the agent, and the agent never sees this question or your answer.
- Answer briefly and directly from the transcript. Quote job ids, repo names, numbers and errors exactly as they appear.
- If the answer is not in the transcript yet, say so plainly rather than guessing. Do not offer to do work; the user can message the agent for that.`;

export class SideQuestionError extends Error {
	constructor(
		readonly reason: "not_found" | "not_ml_assistant" | "no_model",
		message: string
	) {
		super(message);
	}
}

/** images are not sent, so nothing ever reaches the processor */
const noImages = (async () => {
	throw new Error("side questions send no images");
}) as unknown as ReturnType<typeof makeImageProcessor>;

function stripReasoning(message: ChatMessageParam): ChatMessageParam {
	if (message.role !== "assistant" || !("reasoning_content" in message)) return message;
	const rest: ChatMessageParam & { reasoning_content?: string } = { ...message };
	delete rest.reasoning_content;
	return rest;
}

/** reasoning only for the turn in progress, older turns are judged by what they did */
function keepCurrentReasoning(units: HistoryUnit[]): HistoryUnit[] {
	const current = units.findLastIndex((unit) => unit.opensTurn);
	return units.map((unit, i) =>
		i >= current
			? unit
			: {
					...unit,
					messages: unit.messages.map(stripReasoning),
					...(unit.question ? { question: unit.question.map(stripReasoning) } : {}),
				}
	);
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: { type?: string; text?: string }) =>
			part?.type === "text" ? (part.text ?? "") : "[image]"
		)
		.join("");
}

export function renderTranscript(messages: ChatMessageParam[]): string {
	const blocks: string[] = [];
	for (const message of messages) {
		if (message.role === "system" || message.role === "developer") continue;
		if (message.role === "user") {
			blocks.push(`### User\n${textOf(message.content)}`);
		} else if (message.role === "assistant") {
			const reasoning = (message as { reasoning_content?: string }).reasoning_content;
			if (reasoning?.trim()) blocks.push(`### Assistant (thinking)\n${reasoning.trim()}`);
			const text = stripThink(textOf(message.content));
			if (text) blocks.push(`### Assistant\n${text}`);
			for (const call of message.tool_calls ?? []) {
				if (call.type !== "function") continue;
				blocks.push(`### Tool call: ${call.function.name}\n${call.function.arguments}`);
			}
		} else if (message.role === "tool") {
			blocks.push(`### Tool result\n${textOf(message.content)}`);
		}
	}
	return blocks.join("\n\n");
}

function runStatus(alive: Awaited<ReturnType<typeof isTurnAlive>> | undefined): string {
	switch (alive?.status) {
		case "running":
			return "The run is in progress; the last turn below is partial.";
		case "parked":
		case "waiting":
			return "The run is parked on a timed wait and will resume on its own.";
		case "awaiting_input":
			return "The run is waiting for the user to answer a question.";
		default:
			return "The run is not active; the transcript below is complete.";
	}
}

/**
 * one model call without tools about the conversation as stored, the live turn included,
 * nothing about it is written anywhere
 */
export async function* answerSideQuestion(opts: {
	conversationId: ObjectId;
	question: string;
	locals: App.Locals;
	providerOverrides?: Record<string, string>;
	signal?: AbortSignal;
}): AsyncGenerator<string, void, void> {
	const conv = await collections.conversations.findOne({ _id: opts.conversationId });
	if (!conv) throw new SideQuestionError("not_found", "Conversation not found");
	if (!isMlAssistantConversation(conv)) {
		throw new SideQuestionError(
			"not_ml_assistant",
			"Side questions are only available in ML Intern conversations"
		);
	}
	const model = models.find((m) => m.id === conv.model);
	if (!model) throw new SideQuestionError("no_model", `Model ${conv.model} is not available`);

	const latest = conv.messages.at(-1);
	const path = latest ? buildSubtree(conv, latest.id) : [];
	const alive = latest?.from === "assistant" ? await isTurnAlive(conv._id, latest.id) : undefined;

	const question = opts.question.trim();
	const status = runStatus(alive);
	const fixedChars = SIDE_QUESTION_PROMPT.length + question.length + status.length + 200;
	const history = await prepareHistory(path, noImages, false, {
		replayToolHistory: true,
		attachReasoning: true,
		contextLengthTokens: model.contextLength,
		maxOutputTokens: MAX_ANSWER_TOKENS,
		slidingWindow: historyWindowEnabled(),
		mlAssistant: true,
	});
	let messages = history.messages;
	if (history.units && model.contextLength) {
		const units = keepCurrentReasoning(history.units);
		const limitChars = windowLimitChars(model.contextLength, MAX_ANSWER_TOKENS);
		messages = renderWindow(units, planWindow(units, { limitChars, fixedChars }));
	} else {
		const current = messages.findLastIndex((m) => m.role === "user");
		messages = messages.map((m, i) => (i < current ? stripReasoning(m) : m));
	}

	const content =
		`<transcript>\n${renderTranscript(messages) || "(empty)"}\n</transcript>\n\n` +
		`${status}\n\nSide question: ${question}`;

	const endpoint = await model.getEndpoint();
	// given a conversationId the endpoint would store a history window start
	const stream = await endpoint({
		messages: [{ from: "user", content }],
		preprompt: SIDE_QUESTION_PROMPT,
		generateSettings: {
			...mlAssistantModelEntry(model.id)?.parameters,
			max_tokens: MAX_ANSWER_TOKENS,
		},
		isMultimodal: false,
		locals: opts.locals,
		abortSignal: opts.signal,
		provider: requestProvider(model, conv, opts.providerOverrides),
		reasoningEffort: "low",
	});

	let raw = "";
	let sent = "";
	for await (const output of stream) {
		const done = output.generated_text != null;
		if (done) raw = output.generated_text ?? raw;
		else if (!output.token?.special) raw += output.token?.text ?? "";
		const visible = stripThink(raw);
		if (visible.length > sent.length && visible.startsWith(sent)) {
			yield visible.slice(sent.length);
			sent = visible;
		}
		if (done) break;
	}
}
