import type { BackendTool } from ".";
import { callSpace, getIpToken } from "./utils";

const hfDocs: BackendTool = {
	name: "hf_docs",
	displayName: "Hugging Face Docs",
	description:
		"Use this tool to get relevant docs snippets regarding Hugging Face open source libraries (transformers, diffusers, accelerate, huggingface_hub) and Hugging Face hf.co platform.",
	isOnByDefault: true,
	parameterDefinitions: {
		query: {
			required: true,
			type: "string",
			description:
				"A search query which will be used to fetch the most relevant docs snippets regarding the user's query",
		},
	},
	async *call({ query }, { messages, ip, username }) {
		const ipToken = await getIpToken(ip, username);

		const userMessages = messages.filter(({ from }) => from === "user");
		const previousUserMessages = userMessages.slice(0, -1);

		const queryWithPreviousMsgs =
			(previousUserMessages.length
				? `Previous questions: \n${previousUserMessages
						.map(({ content }) => `- ${content}`)
						.join("\n")}`
				: "") +
			"\n\nCurrent Question: " +
			String(query);

		const outputs = await callSpace<string[], string[]>(
			"huggingchat/hf-docs",
			"/predict",
			[queryWithPreviousMsgs, "RAG-friendly"],
			ipToken
		);

		return {
			outputs: [{ hfDocs: outputs[0] }],
			display: false,
		};
	},
};

export default hfDocs;
