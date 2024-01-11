import { createEmbeddings, findSimilarSentences } from "$lib/server/embeddings";
import type { Conversation } from "$lib/types/Conversation";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { downloadPdfEmbeddings } from "../../files/downloadFile";
import { Tensor } from "@xenova/transformers";
import type { RAG } from "../RAG";
import type { RagContext } from "$lib/types/rag";
import type { BuildPromptMessage } from "$lib/buildPrompt";

// todo: embed the prompt, download the embeddings, serialize them, and find the closest sentences, and get their texts, lets go
async function runPdfSearch(
	conv: Conversation,
	prompt: string,
	updatePad: (upd: MessageUpdate) => void
) {
	const pdfSearch: RagContext = {
		context: "",
		type: "pdfChat",
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	function appendUpdate(message: string, args?: string[], type?: "error" | "update" | "done") {
		updatePad({ type: "pdfChat", messageType: type ?? "update", message: message, args: args });
	}

	try {
		appendUpdate("Extracting relevant information from PDF file");
		const { content, textChunks, dims } = await downloadPdfEmbeddings(conv._id);
		// reconstruct pdfEmbeddings
		const buffer = Buffer.from(content);
		const data = new Float32Array(
			buffer.buffer,
			buffer.byteOffset,
			buffer.length / Float32Array.BYTES_PER_ELEMENT
		);
		const pdfEmbeddings = new Tensor("float32", data, dims);
		const promptEmbeddings = await createEmbeddings([prompt]);

		const indices = findSimilarSentences(pdfEmbeddings, promptEmbeddings, { topK: 5 });
		pdfSearch.context = indices.map((idx) => textChunks[idx]).join(" ");

		appendUpdate("Done", [], "done");
	} catch (pdfError) {
		if (pdfError instanceof Error) {
			appendUpdate(
				"An error occurred with the pdf search",
				[JSON.stringify(pdfError.message)],
				"error"
			);
		}
	}

	return pdfSearch;
}

function buildPrompt(messages: BuildPromptMessage[], context: RagContext){
	const lastMsg = messages.slice(-1)[0];
	const messagesWithoutLastUsrMsg = messages.slice(0, -1);
	const previousUserMessages = messages.filter((el) => el.from === "user").slice(0, -1);

	const previousQuestions =
		previousUserMessages.length > 0
			? `Previous questions: \n${previousUserMessages
					.map(({ content }) => `- ${content}`)
					.join("\n")}`
			: "";

	messages = [
		...messagesWithoutLastUsrMsg,
		{
			from: "user",
			content: `Below are the information I extracted from a PDF file that might be useful:
			=====================
			${context.context}
			=====================
			${previousQuestions}
			Answer the question: ${lastMsg.content} 
			`,
		},
	];
	return messages;
}

export const ragPdfchat: RAG = {
	type: "pdfChat", 
	retrieveRagContext: runPdfSearch,
	buildPrompt,
}