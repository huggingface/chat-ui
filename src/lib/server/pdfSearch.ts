import type { PdfSearch } from "$lib/types/PdfChat";
import { createEmbeddings, findSimilarSentences } from "$lib/server/embeddings";
import type { Conversation } from "$lib/types/Conversation";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { downloadPdfEmbeddings } from "./files/downloadFile";
import { Tensor } from "@xenova/transformers";

// todo: embed the prompt, download the embeddings, serialize them, and find the closest sentences, and get their texts, lets go
export async function runPdfSearch(
	conv: Conversation,
	prompt: string,
	updatePad: (upd: MessageUpdate) => void
) {
	const pdfSearch: PdfSearch = {
		context: "",
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	function appendUpdate(message: string, args?: string[], type?: "error" | "update" | "done") {
		updatePad({ type: "pdfSearch", messageType: type ?? "update", message: message, args: args });
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
