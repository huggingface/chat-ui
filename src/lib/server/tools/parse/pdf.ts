import type { BackendTool } from "..";
import { ToolResultStatus } from "$lib/types/Tool";
import { callSpace } from "../utils";
import { downloadFile } from "$lib/server/files/downloadFile";

type PdfParserInput = [Blob /* pdf */];
type PdfParserOutput = [string /* markdown */, Record<string, unknown> /* metadata */];

const pdfParser: BackendTool = {
	name: "pdf_parser",
	displayName: "PDF Parser",
	description: "Use this tool to parse a PDF and get its content in markdown format.",
	isOnByDefault: true,
	parameterDefinitions: {
		fileMessageIndex: {
			description: "Index of the message containing the pdf file to parse",
			type: "number",
			required: true,
		},
		fileIndex: {
			description: "Index of the pdf file to parse",
			type: "number",
			required: true,
		},
	},
	async *call({ fileMessageIndex, fileIndex }, { conv, messages }) {
		fileMessageIndex = Number(fileMessageIndex);
		fileIndex = Number(fileIndex);

		const message = messages[fileMessageIndex];
		const pdfs = message?.files ?? [];
		if (!pdfs || pdfs.length === 0) {
			return {
				status: ToolResultStatus.Error,
				message: "User did not provide a pdf to parse",
			};
		}
		if (fileIndex >= pdfs.length) {
			return {
				status: ToolResultStatus.Error,
				message: "Model provided an invalid file index",
			};
		}
		if (!pdfs[fileIndex].mime.startsWith("application/pdf")) {
			return {
				status: ToolResultStatus.Error,
				message: "Model provided a file index which is not a pdf",
			};
		}

		const pdf = await downloadFile(pdfs[fileIndex].value, conv._id)
			.then((file) => fetch(`data:${file.mime};base64,${file.value}`))
			.then((res) => res.blob());

		const outputs = await callSpace<PdfParserInput, PdfParserOutput>(
			"huggingchat/pdf-to-markdown",
			"predict",
			[pdf]
		);

		const outputMarkdown = outputs[0];
		return {
			status: ToolResultStatus.Success,
			outputs: [{ pdfParserMarkdown: outputMarkdown }],
			display: false,
		};
	},
};

export default pdfParser;
