import { ToolResultStatus } from "$lib/types/Tool";
import type { BackendTool } from ".";
import { CodeInterpreter } from "@e2b/code-interpreter";
import { uploadFile } from "../files/uploadFile";
import { TextGenerationUpdateType } from "../textGeneration/types";

const codeInterpreter: BackendTool = {
	name: "code_interpreter",
	displayName: "Code Interpreter",
	description: `
- the python code runs in jupyter notebook.
- every time you call \`code_interpreter\` tool, the python code is executed in a separate cell. it's okay to multiple calls to \`code_interpreter\`.
- display visualizations using matplotlib or any other visualization library directly in the notebook. don't worry about saving the visualizations to a file.
- you have access to the internet and can make api requests.
- you also have access to the filesystem and can read/write files.
- you can install any pip package (if it exists) if you need to but the usual packages for data analysis are already preinstalled.
- you can run any python code you want, everything is running in a secure sandbox environment.
  `,
	isOnByDefault: true,
	parameter_definitions: {
		code: {
			description:
				"The python code to evaluate in a Jupyter Notebook cell with support for output images such as via matplotlib.",
			type: "str",
			required: true,
		},
	},
	async *call(params, { conv }) {
		try {
			const code = params.code;

			const sandbox = await CodeInterpreter.create();
			const execution = await sandbox.notebook.execCell(code);
			await sandbox.close();

			if (execution.error) {
				throw Error(execution.error.value, { cause: execution.error });
			}

			const outputs: Record<string, unknown>[] = [];
			for (const result of execution.results) {
				if (result.jpeg || result.png || result.svg) {
					const mime = result.jpeg ? "image/jpeg" : result.png ? "image/png" : "image/svg+xml";
					const base64Data = result.jpeg ?? result.png ?? result.svg ?? "";
					const buffer = Buffer.from(base64Data, "base64");
					const blob = new Blob([buffer], { type: mime });
					const sha = await uploadFile(blob, conv);
					yield { type: TextGenerationUpdateType.File, sha };
					outputs.push({
						image:
							"An image has been generated and shown to the user. Answer as if the user can already see the image. Do not try to insert the image or to add space for it. The user can already see the image. Do not try to describe the image as you the model cannot see it",
					});
				} else if (result.markdown) outputs.push({ markdown: result.markdown });
				else if (result.html) outputs.push({ html: result.html });
				else if (result.text) outputs.push({ text: result.text });
			}
			if (execution.text) {
				outputs.push({ text: execution.text });
			}
			if (execution.logs.stdout.length) {
				outputs.push({ stdout: execution.logs.stdout.join("\n") });
			}
			if (execution.logs.stderr.length) {
				outputs.push({ stderr: execution.logs.stderr.join("\n") });
			}

			return {
				status: ToolResultStatus.Success,
				outputs,
			};
		} catch (e) {
			return {
				status: ToolResultStatus.Error,
				message: `Failed to execute code: ${e.message}`,
			};
		}
	},
};

export default codeInterpreter;
