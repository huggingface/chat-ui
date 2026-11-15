import type { Message } from "$lib/types/Message";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { toolRounds } from "$lib/utils/messageShape";
import type { DecisionCase } from "./types";

const TEXT_LIMIT = 4000;

function clip(text: string | undefined, limit = TEXT_LIMIT): string {
	if (!text) return "";
	return text.length > limit
		? `${text.slice(0, limit)}\n… [${text.length - limit} more chars]`
		: text;
}

function resultText(message: Message, uuid: string): string | undefined {
	for (const update of message.updates ?? []) {
		if (update.type !== MessageUpdateType.Tool || update.uuid !== uuid) continue;
		if (update.subtype === MessageToolUpdateType.Error) return `Error: ${update.message}`;
		if (update.subtype !== MessageToolUpdateType.Result) continue;
		const result = update.result;
		if (result.status === ToolResultStatus.Error) return `Error: ${result.message}`;
		return result.outputs.map((o) => (typeof o.text === "string" ? o.text : "")).join("\n");
	}
	return undefined;
}

/**
 * The script a job or sandbox call names as v-file://<name>, rebuilt from the write_file and
 * edit_file calls before the cut, so a reviewer can tell a smoke run from a full one.
 */
function virtualFiles(messages: Message[]): Map<string, string> {
	const files = new Map<string, string>();
	for (const message of messages) {
		for (const update of message.updates ?? []) {
			if (update.type !== MessageUpdateType.Tool || update.subtype !== MessageToolUpdateType.Call) {
				continue;
			}
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse(update.argumentsRaw ?? "{}");
			} catch {
				continue;
			}
			const name = typeof args.name === "string" ? args.name : undefined;
			if (!name) continue;
			if (update.call.name === "write_file" && typeof args.content === "string") {
				files.set(name, args.content);
			} else if (update.call.name === "edit_file" && Array.isArray(args.edits)) {
				let text = files.get(name) ?? "";
				for (const edit of args.edits as Array<{ old?: string; new?: string }>) {
					if (edit.old !== undefined && edit.new !== undefined)
						text = text.replace(edit.old, edit.new);
				}
				files.set(name, text);
			}
		}
	}
	return files;
}

/** the parts of a case a reviewer, human or model, needs to judge it */
export function caseView(c: DecisionCase) {
	const messages = c.conversation.messages;
	const target = messages[messages.length - 1];
	const users = messages.filter((m) => m.from === "user");
	const rounds = toolRounds(target.updates ?? []).slice(-5);
	const previous = [...messages.slice(0, -1)].reverse().find((m) => m.from === "assistant");
	const files = virtualFiles(messages);
	const referenced = JSON.stringify(c.observed.action).match(/v-file:\/\/[\w.\-/]+/g) ?? [];
	const scripts = [...new Set(referenced)].map((ref) => {
		const name = ref.replace("v-file://", "").replace(/@v\d+$/, "");
		return { name, content: clip(files.get(name), 20000) };
	});
	return {
		id: c.id,
		family: c.family,
		model: c.model,
		date: target.createdAt,
		conversationId: c.source.conversationId,
		round: c.source.round,
		feedback: c.source.feedback,
		trigger: c.trigger,
		context: c.context,
		observed: c.observed,
		aftermath: c.aftermath ?? [],
		firstUser: clip(users[0]?.content, 2500),
		lastUser: users.length > 1 ? clip(users[users.length - 1]?.content, 2500) : "",
		previousAnswer: rounds.length < 2 ? clip(previous?.content, 2500) : "",
		rounds: rounds.map((round) => ({
			reasoning: clip(round.calls[0]?.reasoning, 2000),
			preamble: clip(round.calls[0]?.content, 1000),
			calls: round.calls.map((call) => ({
				name: call.call.name,
				args: clip(call.argumentsRaw ?? JSON.stringify(call.call.parameters), 2500),
				result: clip(resultText(target, call.uuid), 3000),
			})),
		})),
		scripts,
	};
}
