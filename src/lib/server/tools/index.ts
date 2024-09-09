import { MessageUpdateType } from "$lib/types/MessageUpdate";
import {
	ToolColor,
	ToolIcon,
	ToolOutputComponents,
	type BackendCall,
	type BaseTool,
	type ConfigTool,
	type ToolInput,
} from "$lib/types/Tool";
import type { TextGenerationContext } from "../textGeneration/types";

import { z } from "zod";
import JSON5 from "json5";
import { env } from "$env/dynamic/private";

import jp from "jsonpath";
import calculator from "./calculator";
import directlyAnswer from "./directlyAnswer";
import fetchUrl from "./web/url";
import websearch from "./web/search";
import { callSpace, getIpToken } from "./utils";
import { uploadFile } from "../files/uploadFile";
import type { MessageFile } from "$lib/types/Message";
import { sha256 } from "$lib/utils/sha256";
import { ObjectId } from "mongodb";
import { isValidOutputComponent, ToolOutputPaths } from "./outputs";
import { downloadFile } from "../files/downloadFile";
import { fileTypeFromBlob } from "file-type";

export type BackendToolContext = Pick<
	TextGenerationContext,
	"conv" | "messages" | "assistant" | "ip" | "username"
> & { preprompt?: string };

const IOType = z.union([z.literal("str"), z.literal("int"), z.literal("float"), z.literal("bool")]);

const toolInputBaseSchema = z.union([
	z.object({
		name: z.string().min(1).max(80),
		description: z.string().max(200).optional(),
		paramType: z.literal("required"),
	}),
	z.object({
		name: z.string().min(1).max(80),
		description: z.string().max(200).optional(),
		paramType: z.literal("optional"),
		default: z
			.union([z.string().max(300), z.number(), z.boolean(), z.undefined()])
			.transform((val) => (val === undefined ? "" : val)),
	}),
	z.object({
		name: z.string().min(1).max(80),
		paramType: z.literal("fixed"),
		value: z
			.union([z.string().max(300), z.number(), z.boolean(), z.undefined()])
			.transform((val) => (val === undefined ? "" : val)),
	}),
]);

const toolInputSchema = toolInputBaseSchema.and(
	z.object({ type: IOType }).or(
		z.object({
			type: z.literal("file"),
			mimeTypes: z.string().min(1),
		})
	)
);

export const editableToolSchema = z
	.object({
		name: z.string().min(1).max(40),
		// only allow huggingface spaces either through namespace or direct URLs
		baseUrl: z.union([
			z.string().regex(/^[^/]+\/[^/]+$/),
			z
				.string()
				.regex(/^https:\/\/huggingface\.co\/spaces\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/)
				.transform((url) => url.split("/").slice(-2).join("/")),
		]),
		endpoint: z.string().min(1).max(100),
		inputs: z.array(toolInputSchema),
		outputComponent: z.string().min(1).max(100),
		showOutput: z.boolean(),
		displayName: z.string().min(1).max(40),
		color: ToolColor,
		icon: ToolIcon,
		description: z.string().min(1).max(100),
	})
	.transform((tool) => ({
		...tool,
		outputComponentIdx: parseInt(tool.outputComponent.split(";")[0]),
		outputComponent: ToolOutputComponents.parse(tool.outputComponent.split(";")[1]),
	}));
export const configTools = z
	.array(
		z
			.object({
				name: z.string(),
				description: z.string(),
				endpoint: z.union([z.string(), z.null()]),
				inputs: z.array(toolInputSchema),
				outputComponent: ToolOutputComponents.or(z.null()),
				outputComponentIdx: z.number().int().default(0),
				showOutput: z.boolean(),
				_id: z
					.string()
					.length(24)
					.regex(/^[0-9a-fA-F]{24}$/)
					.transform((val) => new ObjectId(val)),
				baseUrl: z.string().optional(),
				displayName: z.string(),
				color: ToolColor,
				icon: ToolIcon,
				isOnByDefault: z.optional(z.literal(true)),
				isLocked: z.optional(z.literal(true)),
				isHidden: z.optional(z.literal(true)),
			})
			.transform((val) => ({
				type: "config" as const,
				...val,
				call: getCallMethod(val),
			}))
	)
	// add the extra hardcoded tools
	.transform((val) => [...val, calculator, directlyAnswer, fetchUrl, websearch]);

export function getCallMethod(tool: Omit<BaseTool, "call">): BackendCall {
	return async function* (params, ctx, uuid) {
		if (
			tool.endpoint === null ||
			!tool.baseUrl ||
			!tool.outputComponent ||
			tool.outputComponentIdx === null
		) {
			throw new Error(`Tool function ${tool.name} has no endpoint`);
		}

		const ipToken = await getIpToken(ctx.ip, ctx.username);

		function coerceInput(value: unknown, type: ToolInput["type"]) {
			const valueStr = String(value);
			switch (type) {
				case "str":
					return valueStr;
				case "int":
					return parseInt(valueStr);
				case "float":
					return parseFloat(valueStr);
				case "bool":
					return valueStr === "true";
				default:
					throw new Error(`Unsupported type ${type}`);
			}
		}
		const inputs = tool.inputs.map(async (input) => {
			if (input.type === "file" && input.paramType !== "required") {
				throw new Error("File inputs are always required and cannot be optional or fixed");
			}

			if (input.paramType === "fixed") {
				return coerceInput(input.value, input.type);
			} else if (input.paramType === "optional") {
				return coerceInput(params[input.name] ?? input.default, input.type);
			} else if (input.paramType === "required") {
				if (params[input.name] === undefined) {
					throw new Error(`Missing required input ${input.name}`);
				}

				if (input.type === "file") {
					// todo: parse file here !
					// structure is {input|output}-{msgIdx}-{fileIdx}-{filename}

					const filename = params[input.name];

					if (!filename || typeof filename !== "string") {
						throw new Error(`Filename is not a string`);
					}

					const messages = ctx.messages;

					const msgIdx = parseInt(filename.split("_")[1]);
					const fileIdx = parseInt(filename.split("_")[2]);

					if (Number.isNaN(msgIdx) || Number.isNaN(fileIdx)) {
						throw Error(`Message index or file index is missing`);
					}

					if (msgIdx >= messages.length) {
						throw Error(`Message index ${msgIdx} is out of bounds`);
					}

					const file = messages[msgIdx].files?.[fileIdx];

					if (!file) {
						throw Error(`File index ${fileIdx} is out of bounds`);
					}

					const blob = await downloadFile(file.value, ctx.conv._id)
						.then((file) => fetch(`data:${file.mime};base64,${file.value}`))
						.then((res) => res.blob())
						.catch((err) => {
							throw Error("Failed to download file", { cause: err });
						});

					return blob;
				} else {
					return coerceInput(params[input.name], input.type);
				}
			}
		});

		const outputs = yield* callSpace(
			tool.baseUrl,
			tool.endpoint,
			await Promise.all(inputs),
			ipToken,
			uuid
		);

		if (!isValidOutputComponent(tool.outputComponent)) {
			throw new Error(`Tool output component is not defined`);
		}

		const { type, path } = ToolOutputPaths[tool.outputComponent];

		if (!path || !type) {
			throw new Error(`Tool output type ${tool.outputComponent} is not supported`);
		}

		const files: MessageFile[] = [];

		const toolOutputs: Array<Record<string, string>> = [];

		if (outputs.length <= tool.outputComponentIdx) {
			throw new Error(`Tool output component index is out of bounds`);
		}

		// if its not an object, return directly
		if (
			outputs[tool.outputComponentIdx] !== undefined &&
			typeof outputs[tool.outputComponentIdx] !== "object"
		) {
			return {
				outputs: [{ [tool.name + "-0"]: outputs[tool.outputComponentIdx] }],
				display: tool.showOutput,
			};
		}

		await Promise.all(
			jp
				.query(outputs[tool.outputComponentIdx], path)
				.map(async (output: string | string[], idx) => {
					const arrayedOutput = Array.isArray(output) ? output : [output];
					if (type === "file") {
						// output files are actually URLs

						await Promise.all(
							arrayedOutput.map(async (output, idx) => {
								await fetch(output)
									.then((res) => res.blob())
									.then(async (blob) => {
										const { ext, mime } = (await fileTypeFromBlob(blob)) ?? { ext: "octet-stream" };

										return new File(
											[blob],
											`${idx}-${await sha256(JSON.stringify(params))}.${ext}`,
											{
												type: mime,
											}
										);
									})
									.then((file) => uploadFile(file, ctx.conv))
									.then((file) => files.push(file));
							})
						);

						toolOutputs.push({
							[tool.name +
							"-" +
							idx.toString()]: `Only and always answer: 'I used the tool ${tool.displayName}, here is the result.' Don't add anything else.`,
						});
					} else {
						for (const output of arrayedOutput) {
							toolOutputs.push({
								[tool.name + "-" + idx.toString()]: output,
							});
						}
					}
				})
		);

		for (const file of files) {
			yield {
				type: MessageUpdateType.File,
				name: file.name,
				sha: file.value,
				mime: file.mime,
			};
		}

		return { outputs: toolOutputs, display: tool.showOutput };
	};
}

export const toolFromConfigs = configTools.parse(JSON5.parse(env.TOOLS)) satisfies ConfigTool[];
