import type { BuildPromptMessage } from "$lib/buildPrompt";
import type { Conversation } from "$lib/types/Conversation";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import type { RagContextWebSearch } from "$lib/types/WebSearch";
import type { RAGType, RagContext } from "$lib/types/rag";
import { ragPdfchat } from "./pdfchat/rag";
import { ragWebsearch } from "./websearch/rag";

type RetrieveRagContextFn<T extends RagContext = RagContext> = (
	conv: Conversation,
	prompt: string,
	updatePad: (upd: MessageUpdate) => void
) => Promise<T>;

type BuildPromptFn<T extends RagContext = RagContext> = (
	messages: BuildPromptMessage[],
	context: T
) => BuildPromptMessage[];

export interface RAG<T extends RagContext = RagContext> {
	type: RAGType;
	retrieveRagContext: RetrieveRagContextFn<T>;
	buildPrompt: BuildPromptFn<T>;
}

type RAGUnion = RAG<RagContext> | RAG<RagContextWebSearch>;

// list of all rags
export const RAGs: {
	[Key in RAGType]: RAGUnion;
} = {
	webSearch: ragWebsearch,
	pdfChat: ragPdfchat,
};

export default RAGs;
