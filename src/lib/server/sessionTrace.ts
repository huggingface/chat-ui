import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolCallUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { ROUNDS_SHAPE, callArguments, toolRounds } from "$lib/utils/messageShape";
import type { buildConversationTrace } from "$lib/server/conversationTrace";

/**
 * The Hub's Session Trace Simple Format, the JSONL its trace viewer renders: a session header
 * then one message per line, tool results as their own lines tied to a call by id
 * https://huggingface.co/docs/hub/session-traces-format
 */
export const SESSION_TRACE_HARNESS = "chat-ui";

type ConversationTrace = Awaited<ReturnType<typeof buildConversationTrace>>;

interface SessionMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	reasoningContent?: string;
	toolCalls?: { id: string; function: { name: string; arguments: string } }[];
	toolCallId?: string;
	timestamp?: number;
	model?: string;
}

const millis = (date: Date | string | undefined) => {
	const time = date ? new Date(date).getTime() : NaN;
	return Number.isNaN(time) ? undefined : time;
};

/** the branch on screen, a regenerated or edited turn is the last child of its parent */
function activeBranch(messages: Message[], rootMessageId?: Message["id"]): Message[] {
	if (!rootMessageId) return messages;
	const byId = new Map(messages.map((message) => [message.id, message]));
	const branch: Message[] = [];
	const seen = new Set<string>();
	let current = byId.get(rootMessageId);
	while (current && !seen.has(current.id)) {
		seen.add(current.id);
		branch.push(current);
		const next: string | undefined = current.children?.at(-1);
		current = next ? byId.get(next) : undefined;
	}
	return branch;
}

const withoutThinkBlocks = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

function toolOutputs(message: Message): Map<string, string> {
	const outputs = new Map<string, string>();
	for (const update of message.updates ?? []) {
		if (update.type !== MessageUpdateType.Tool) continue;
		if (update.subtype === MessageToolUpdateType.Error) {
			outputs.set(update.uuid, `Error: ${update.message}`);
		} else if (update.subtype === MessageToolUpdateType.Result) {
			const result = update.result;
			if (result.status !== ToolResultStatus.Success) {
				outputs.set(update.uuid, `Error: ${result.message}`);
				continue;
			}
			const [first] = result.outputs;
			outputs.set(
				update.uuid,
				typeof first?.text === "string" ? first.text : JSON.stringify(first ?? "")
			);
		}
	}
	return outputs;
}

function assistantMessages(message: Message, fallbackModel: string): SessionMessage[] {
	const model = message.harness?.model ?? message.routerMetadata?.model ?? fallbackModel;
	const timestamp = millis(message.updatedAt ?? message.createdAt);
	const rounds = toolRounds(message.updates ?? []);
	// the older shape keeps every round's text in content, so it all goes on the final message
	const perRound = message.contentShape === ROUNDS_SHAPE;
	const outputs = toolOutputs(message);
	const lines: SessionMessage[] = [];

	for (const { calls } of rounds) {
		const reasoning = perRound ? calls.find((call) => call.reasoning?.trim())?.reasoning : "";
		lines.push({
			role: "assistant",
			content: perRound ? (calls.find((call) => call.content?.trim())?.content ?? "") : "",
			...(reasoning ? { reasoningContent: reasoning } : {}),
			toolCalls: calls.map((call: MessageToolCallUpdate) => ({
				id: call.uuid,
				function: { name: call.call.name, arguments: JSON.stringify(callArguments(call)) },
			})),
			timestamp,
			model,
		});
		for (const call of calls) {
			lines.push({
				role: "tool",
				toolCallId: call.uuid,
				content: outputs.get(call.uuid) ?? "Error: interrupted before a result was recorded",
				timestamp,
			});
		}
	}

	const content = perRound ? message.content.trim() : withoutThinkBlocks(message.content);
	if (content || message.reasoning || rounds.length === 0) {
		lines.push({
			role: "assistant",
			content,
			...(message.reasoning ? { reasoningContent: message.reasoning } : {}),
			timestamp,
			model,
		});
	}
	return lines;
}

export function toSessionTrace(trace: ConversationTrace): string {
	const { conversation } = trace;
	const header = {
		type: "session",
		harness: SESSION_TRACE_HARNESS,
		id: conversation.id,
		name: conversation.title,
		// the viewer ignores extra fields, these keep what a message list cannot hold
		chatUi: {
			model: conversation.model,
			createdAt: conversation.createdAt,
			updatedAt: conversation.updatedAt,
			exportedAt: trace.exportedAt,
			mlAssistant: conversation.mlAssistant,
			services: trace.services,
			artefacts: trace.artefacts,
			agentRuns: trace.agentRuns,
			sources: trace.sources,
		},
	};

	const messages: SessionMessage[] = [];
	if (conversation.preprompt?.trim()) {
		messages.push({ role: "system", content: conversation.preprompt });
	}
	for (const message of activeBranch(conversation.messages, conversation.rootMessageId)) {
		if (message.from === "system") {
			// the root holds the preprompt when it holds anything
			if (message.content.trim() && !conversation.preprompt?.trim()) {
				messages.push({ role: "system", content: message.content });
			}
		} else if (message.from === "user") {
			messages.push({
				role: "user",
				content: message.content,
				timestamp: millis(message.createdAt),
			});
		} else {
			messages.push(...assistantMessages(message, conversation.model));
		}
	}

	return (
		[header, ...messages.map((message) => ({ type: "message", message }))]
			.map((line) => JSON.stringify(line))
			.join("\n") + "\n"
	);
}
