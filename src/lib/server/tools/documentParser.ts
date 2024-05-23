import type { BackendTool } from ".";
import { ToolResultStatus } from "$lib/types/Tool";
import { callSpace } from "./utils";
import { downloadFile } from "$lib/server/files/downloadFile";

type PdfParserInput = [Blob /* pdf */, string /* filename */];
type PdfParserOutput = [string /* markdown */, Record<string, unknown> /* metadata */];

const documentParser: BackendTool = {
	name: "document_parser",
	displayName: "Document Parser",
	description: "Use this tool to parse any document and get its content in markdown format.",
	isOnByDefault: true,
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
	async *call({ fileMessageIndex, fileIndex }, { conv, messages }) {
		fileMessageIndex = Number(fileMessageIndex);
		fileIndex = Number(fileIndex);

		const message = messages[fileMessageIndex];
		const files = message?.files ?? [];
		if (!files || files.length === 0) {
			return {
				status: ToolResultStatus.Error,
				message: "User did not provide a pdf to parse",
			};
		}
		if (fileIndex >= files.length) {
			return {
				status: ToolResultStatus.Error,
				message: "Model provided an invalid file index",
			};
		}

		const file = files[fileIndex];
		console.log(file);
		const fileBlob = await downloadFile(files[fileIndex].value, conv._id)
			.then((file) => fetch(`data:${file.mime};base64,${file.value}`))
			.then((res) => res.blob());

		const outputs = await callSpace<PdfParserInput, PdfParserOutput>(
			"huggingchat/document-parser",
			"predict",
			[fileBlob, file.name]
		);

		const documentMarkdown = outputs[0];
		return {
			status: ToolResultStatus.Success,
			outputs: [{ [file.name]: documentMarkdown }],
			display: false,
		};
	},
};

export default documentParser;
