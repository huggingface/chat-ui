import type { BackendTool } from "..";
import { ToolResultStatus } from "$lib/types/Tool";
import { callSpace, type GradioImage } from "../utils";
import { downloadFile } from "$lib/server/files/downloadFile";

type PdfParserInput = [Blob /* pdf */, boolean /* include images */];
type PdfParserOutput = [
	string /* markdown */,
	Record<string, unknown> /* metadata */,
	GradioImage[] | undefined /* extracted images if enabled */
];

const pdfParser: BackendTool = {
	name: "pdf-parser",
	displayName: "PDF Parser",
	description: "Use this tool to parse a PDF and get its content in markdown format.",
	isOnByDefault: true,
	parameterDefinitions: {
		fileIndex: {
			description: "Index of the pdf file to parse",
			type: "number",
			required: true,
		},
	},
	async *call({ fileIndex }, { conv, messages }) {
		fileIndex = Number(fileIndex);

		const latestUserMessage = messages.findLast((message) => message.from === "user");
		const pdfs = latestUserMessage?.files ?? [];
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
			"saghen/pdf-to-markdown",
			"predict",
			[pdf, false]
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
