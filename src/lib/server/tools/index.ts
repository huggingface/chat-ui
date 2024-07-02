import { MessageUpdateType } from "$lib/types/MessageUpdate";
import type { BackendCall, BaseTool, ConfigTool, ToolInput } from "$lib/types/Tool";
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

export type BackendToolContext = Pick<
	TextGenerationContext,
	"conv" | "messages" | "assistant" | "ip" | "username"
> & { preprompt?: string };

const IOType = z.union([
	z.literal("str"),
	z.literal("int"),
	z.literal("float"),
	z.literal("boolean"),
]);

const ToolColor = z.union([
	z.literal("purple"),
	z.literal("blue"),
	z.literal("green"),
	z.literal("yellow"),
	z.literal("red"),
]);

const ToolIcon = z.union([
	z.literal("wikis"),
	z.literal("tools"),
	z.literal("camera"),
	z.literal("code"),
	z.literal("email"),
	z.literal("cloud"),
	z.literal("terminal"),
	z.literal("game"),
	z.literal("chat"),
	z.literal("speaker"),
	z.literal("video"),
]);

const toolInputBaseSchema = z.union([
	z.object({
		name: z.string().min(1),
		description: z.string().optional(),
		paramType: z.literal("required"),
	}),
	z.object({
		name: z.string().min(1),
		description: z.string().optional(),
		paramType: z.literal("optional"),
		default: z
			.union([z.string(), z.number(), z.boolean(), z.undefined()])
			.transform((val) => (val === undefined ? "" : val)),
	}),
	z.object({
		name: z.string().min(1),
		paramType: z.literal("fixed"),
		value: z
			.union([z.string(), z.number(), z.boolean(), z.undefined()])
			.transform((val) => (val === undefined ? "" : val)),
	}),
]);

const toolInputSchema = toolInputBaseSchema.and(
	z.object({ type: IOType }).or(
		z.object({
			type: z.literal("file"),
			mimeTypes: z.array(z.string()).nonempty(),
		})
	)
);

export const editableToolSchema = z.object({
	name: z.string().min(1),
	baseUrl: z.string().min(1),
	endpoint: z.string().min(1),
	inputs: z.array(toolInputSchema),
	outputPath: z.string(),
	outputType: IOType.or(z.literal("file")),
	outputMimeType: z.string().optional(),
	showOutput: z.boolean(),

	displayName: z.string().min(1),
	color: ToolColor,
	icon: ToolIcon,
	description: z.string().min(1),
});

export const configTools = z
	.array(
		z
			.object({
				name: z.string(),
				description: z.string(),
				endpoint: z.union([z.string(), z.null()]),
				inputs: z.array(toolInputSchema),
				outputPath: z.union([z.string(), z.null()]),
				outputType: IOType.or(z.literal("file")),
				outputMimeType: z.string().optional(), // only required for file outputs
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
	return async function* (params, ctx) {
		if (tool.endpoint === null || !tool.baseUrl) {
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
				case "boolean":
					return valueStr === "true";
				default:
					throw new Error(`Unsupported type ${type}`);
			}
		}
		const inputs = tool.inputs.map((input) => {
			if (input.type === "file") {
				throw new Error("File inputs are not supported");
			}

			if (input.paramType === "fixed") {
				return coerceInput(input.value, input.type);
			} else if (input.paramType === "optional") {
				return coerceInput(params[input.name] ?? input.default, input.type);
			} else if (input.paramType === "required") {
				if (params[input.name] === undefined) {
					throw new Error(`Missing required input ${input.name}`);
				}
				return coerceInput(params[input.name], input.type);
			}
		});

		const outputs = await callSpace(tool.baseUrl, tool.endpoint, inputs, ipToken);
		if (tool.outputPath === null) {
			throw new Error(`Tool function ${tool.name} has no output path`);
		}
		const files: MessageFile[] = [];

		const toolOutputs: Array<Record<string, string>> = [];

		await Promise.all(
			jp.query(outputs, tool.outputPath).map(async (output: string | string[], idx) => {
				if (tool.outputType === "file") {
					// output files are actually URLs
					const outputs = Array.isArray(output) ? output : [output];

					await Promise.all(
						outputs.map(async (output, idx) => {
							await fetch(output)
								.then((res) => res.blob())
								.then(async (blob) => {
									const fileType = blob.type.split("/")[1] ?? tool.outputMimeType?.split("/")[1];
									return new File(
										[blob],
										`${idx}-${await sha256(JSON.stringify(params))}.${fileType}`,
										{
											type: fileType,
										}
									);
								})
								.then((file) => uploadFile(file, ctx.conv))
								.then((file) => files.push(file));
						})
					);

					toolOutputs.push({
						[tool.name + "-" + idx.toString()]:
							"A file has been generated. Answer as if the user can already see the image. Do not try to insert the image or to add space for it. The user can already see the image. Do not try to describe the image as you the model cannot see it. Be concise.",
					});
				} else {
					outputs.push({
						[tool.name + "-" + idx.toString()]: output,
					});
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
