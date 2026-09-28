import type { InferenceProvider } from "@huggingface/inference";
import type { MessageUpdate } from "./MessageUpdate";
import type { Timestamps } from "./Timestamps";
import type { v4 } from "uuid";

export type Message = Partial<Timestamps> & {
	from: "user" | "assistant" | "system";
	id: ReturnType<typeof v4>;
	content: string;
	updates?: MessageUpdate[];

	// Optional server or client-side reasoning content (<think> blocks)
	reasoning?: string;
	/** 2 when a finished turn keeps round text on its calls and only its answer in content */
	contentShape?: 2;
	score?: -1 | 0 | 1;

	/**
	 * The run that produced this message. Absent on messages written before
	 * generation events existed, which is how a reader tells the two apart.
	 */
	generationId?: string;
	/**
	 * Highest `generationEvents.seq` already folded into `content`/`reasoning`.
	 * A reader resumes from here. Written in the same $set as the content it
	 * describes, so the two can never disagree — except on a stopped run, whose
	 * content is deliberately clamped back to what the user saw.
	 */
	materializedSeq?: number;
	/**
	 * Either contains the base64 encoded image data
	 * or the hash of the file stored on the server
	 **/
	files?: MessageFile[];
	interrupted?: boolean;

	// Router metadata when using llm-router
	routerMetadata?: {
		route: string;
		model: string;
		provider?: InferenceProvider;
	};

	/** what the latest run ran under, ml assistant only, never sent to the model */
	harness?: MessageHarness;

	// needed for conversation trees
	ancestors?: Message["id"][];

	// goes one level deep
	children?: Message["id"][];
};

export type MessageHarness = {
	/** PUBLIC_COMMIT_SHA of the build, dev when unset */
	build: string;
	/** first 12 hex of the sha256 of the preset prompt, tool doctrine and builtin tool text sent */
	prompt: string;
	features: {
		virtualFiles: boolean;
		stateBlock: boolean;
		servicePoller: boolean;
		serviceEvents: boolean;
		slidingWindow: boolean;
	};
	model: string;
	/** the provider ML_ASSISTANT_MODELS pins the model to, when it pins one */
	provider?: string;
	/** runs stamped on this message, this one included */
	runs: number;
};

export type MessageFile = {
	type: "hash" | "base64";
	name: string;
	value: string;
	mime: string;
};
