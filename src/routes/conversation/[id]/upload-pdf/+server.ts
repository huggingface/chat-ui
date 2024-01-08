import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { MAX_SEQ_LEN as CHUNK_CAR_LEN, createEmbeddings } from "$lib/server/embeddings";
import { uploadPdfEmbeddings } from "$lib/server/files/uploadFile";
import { chunk } from "$lib/utils/chunk";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { getDocument } from "pdfjs-dist";

export async function POST({ request, params, locals }) {
	const conversationId = new ObjectId(params.id);
	const conversation = await collections.conversations.findOne({
		_id: conversationId,
		...authCondition(locals),
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	const formData = await request.formData();
	const file = formData.get("pdf"); // 'pdf' is the name used in FormData on the frontend
	if (!file || typeof file === "string") {
		throw error(400, "No file provided");
	}
	const data = new Uint8Array(await file.arrayBuffer());
	const pdf = await getDocument({ data }).promise;

	const N_MAX_PAGES = 20;
	let text = "";
	for (let i = 1; i <= Math.min(pdf.numPages, N_MAX_PAGES); i++) {
		const page = await pdf.getPage(i);
		const content = await page.getTextContent();
		text += content.items.map((item) => (item as { str?: string }).str ?? "").join(" ");
	}

	const textChunks = chunk(text, CHUNK_CAR_LEN);
	const embeddings = await createEmbeddings(textChunks);

	await uploadPdfEmbeddings(embeddings, textChunks, conversation);

	return new Response();
}
