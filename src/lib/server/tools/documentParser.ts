import type { BackendTool } from ".";
import { callSpace, getIpToken } from "./utils";
import { downloadFile } from "$lib/server/files/downloadFile";

type PdfParserInput = [Blob /* pdf */, string /* filename */];
type PdfParserOutput = [string /* markdown */, Record<string, unknown> /* metadata */];

const documentParser: BackendTool = {
	name: "document_parser",
	displayName: "Document Parser",
	description: "Use this tool to parse any document and get its content in markdown format.",
	mimeTypes: ["application/*", "text/*"],
	parameterDefinitions: {
		fileMessageIndex: {
			description: "Index of the message containing the document file to parse",
			type: "number",
			required: true,
		},
		fileIndex: {
			description: "Index of the document file to parse",
			type: "number",
			required: true,
		},
	},
	async *call({ fileMessageIndex, fileIndex }, { conv, messages, ip, username }) {
		fileMessageIndex = Number(fileMessageIndex);
		fileIndex = Number(fileIndex);

		const message = messages[fileMessageIndex];
		const files = message?.files ?? [];
		if (!files || files.length === 0) throw Error("User did not provide a pdf to parse");
		if (fileIndex >= files.length) throw Error("Model provided an invalid file index");

		const file = files[fileIndex];
		const fileBlob = await downloadFile(files[fileIndex].value, conv._id)
			.then((file) => fetch(`data:${file.mime};base64,${file.value}`))
			.then((res) => res.blob());

		const ipToken = await getIpToken(ip, username);

		const outputs = await callSpace<PdfParserInput, PdfParserOutput>(
			"huggingchat/document-parser",
			"predict",
			[fileBlob, file.name],
			ipToken
		);

		let documentMarkdown = outputs[0];
		// TODO: quick fix for avoiding context limit. eventually should use the tokenizer
		if (documentMarkdown.length > 30_000) {
			documentMarkdown = documentMarkdown.slice(0, 30_000) + "\n\n... (truncated)";
		}
		return {
			outputs: [{ [file.name]: documentMarkdown }],
			display: false,
		};
	},
};

export default documentParser;
