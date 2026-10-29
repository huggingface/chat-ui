import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolCallUpdate,
} from "$lib/types/MessageUpdate";
import { isGpu, isJobSubmit, isSandboxWork, jobFlavor, scriptName } from "./labels";
import type { Action, ActionCall, DecisionCase } from "./types";

export const FILE_NAME = /[\w.-]+\.(?:py|sh|ipynb|ya?ml|json|toml)\b/g;

function callArgs(update: MessageToolCallUpdate): Record<string, unknown> {
	if (update.argumentsRaw) {
		try {
			const parsed: unknown = JSON.parse(update.argumentsRaw);
			if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
		} catch {
			// a cut stream leaves argumentsRaw unparseable, the stored parameters are all there is
		}
	}
	return update.call.parameters;
}

export function toActionCall(update: MessageToolCallUpdate): ActionCall {
	return { name: update.call.name, args: callArgs(update) };
}

/** file names any sandbox call before the cut mentioned, as the miner counts them */
export function sandboxedFiles(messages: Message[]): Set<string> {
	const files = new Set<string>();
	for (const message of messages) {
		for (const update of message.updates ?? []) {
			if (update.type !== MessageUpdateType.Tool || update.subtype !== MessageToolUpdateType.Call) {
				continue;
			}
			const call = toActionCall(update);
			if (!isSandboxWork(call)) continue;
			for (const name of JSON.stringify(call.args).match(FILE_NAME) ?? []) files.add(name);
		}
	}
	return files;
}

/** a re-sampled step can run another script than production did, so first-gpu-job's facts are redone for it */
export function contextFor(c: DecisionCase, action: Action): DecisionCase["context"] {
	if (c.family !== "first-gpu-job") return c.context;
	const job =
		action.kind === "calls"
			? action.calls.find((call) => isJobSubmit(call) && isGpu(jobFlavor(call)))
			: undefined;
	const sandboxed = sandboxedFiles(c.conversation.messages);
	const script = job ? scriptName(job) : undefined;
	return {
		...c.context,
		script,
		sandboxedScript: script ? sandboxed.has(script) : undefined,
		// a step that only says which script it will submit is judged against these
		sandboxedFiles: job ? undefined : [...sandboxed],
	};
}
