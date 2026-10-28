import type { Message, MessageHarness } from "$lib/types/Message";

export type Family = "first-gpu-job" | "after-job-failure" | "after-oom" | "after-stale-api";

/** who reported a conversation, so its cases can be traced back to the feedback they answer */
export interface Feedback {
	by: string;
	link: string;
	note?: string;
}

/** one tool call reduced to what the scorers read, from a stored turn or a sampled completion */
export interface ActionCall {
	name: string;
	args: Record<string, unknown>;
}

/** the next round after the cut: its calls, or the turn ending in text */
export type Action =
	| {
			kind: "calls";
			calls: ActionCall[];
			/** what the model thought and said before the calls, for a reviewer, never scored */
			reasoning?: string;
			preamble?: string;
			/** how many rounds the calls span, more than one when the family scores until a decisive call */
			rounds?: number;
	  }
	| { kind: "final"; text: string };

export interface DecisionCase {
	/** `<family>/<conversationId>/<messageId>/r<round>` */
	id: string;
	family: Family;
	source: {
		conversationId: string;
		messageId: string;
		/** index of the decision round in the message's tool rounds, equal to the count when the turn ended in text */
		round: number;
		/** export file the conversation was read from, the newest one holding it */
		exportFile: string;
		harness?: MessageHarness;
		feedback?: Feedback;
	};
	model: { id: string; provider?: string };
	/** the tool output that put the agent at this decision, absent for first-gpu-job */
	trigger?: { tool: string; excerpt: string };
	/** what the scorer needs from before the cut */
	context: {
		/** the flavor the job ran out of memory on */
		failedFlavor?: string;
		/** whether any sandbox work came before the first GPU job */
		sandboxUsed?: boolean;
		/** the job's v-file script, and whether a sandbox call before the cut named it */
		script?: string;
		sandboxedScript?: boolean;
		/** distinct jobs failed on this path, this one included */
		failedJobsSoFar?: number;
		/** the v-file script the failed job ran, to tell a resubmit from running something else */
		failedScript?: string;
	};
	/** up to three rounds after the decision, clipped: how it turned out, for review only */
	aftermath: Array<{ name: string; args: string; result: string }>;
	/** what production did at the cut, and how the family's scorer labels it */
	observed: { action: Action; label: string; pass: boolean | null };
	/**
	 * the conversation down the path to the decision, the target turn cut before the decision round,
	 * kept in the stored shape so the replay under test builds the request, not this file
	 */
	conversation: {
		model: string;
		preprompt?: string;
		mlAssistant?: boolean;
		messages: Message[];
	};
}
