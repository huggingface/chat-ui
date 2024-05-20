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
	parameterDefinitions: {},
	async *call(_, { conv, messages }) {
		const latestUserMessage = messages.findLast((message) => message.from === "user");
		const pdfs = latestUserMessage?.files?.filter((file) => file.mime === "application/pdf");
		if (!pdfs || pdfs.length === 0) {
			return {
				status: ToolResultStatus.Error,
				message: "User did not provide a pdf to parse",
			};
		}

		// todo: should handle multiple images
		const pdf = await downloadFile(pdfs[0].value, conv._id)
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
