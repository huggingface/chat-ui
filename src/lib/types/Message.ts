import type { MessageUpdate } from "./MessageUpdate";
import type { Timestamps } from "./Timestamps";
import type { RagContextWebSearch } from "./WebSearch";
import type { RagContext } from "./rag";

export type Message = Partial<Timestamps> & {
	from: "user" | "assistant";
	id: ReturnType<typeof crypto.randomUUID>;
	content: string;
	updates?: MessageUpdate[];
	webSearchId?: RagContextWebSearch["_id"]; // legacy version
	ragContexts?: {
		webSearch?: RagContextWebSearch;
		pdfChat?: RagContext;
	};
	score?: -1 | 0 | 1;
	files?: string[]; // can contain either the hash of the file or the b64 encoded image data on the client side when uploading
};
