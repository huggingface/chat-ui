import { MessageUpdateType } from "$lib/types/MessageUpdate";
import type { BackendCall, ConfigTool, ToolFunction } from "$lib/types/Tool";
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

export const configTools = z
	.array(
		z
			.object({
				functions: z.array(
					z.object({
						name: z.string(),
						displayName: z.string(),
						description: z.string(),
						endpoint: z.union([z.string(), z.null()]),
						inputs: z.array(
							z
								.object({
									name: z.string(),
									description: z.string(),
									required: z.boolean(),
									default: z.union([z.string(), z.number(), z.boolean()]).optional(),
									type: IOType,
								})
								.or(
									z.object({
										name: z.string(),
										description: z.string(),
										required: z.boolean(),
										type: z.literal("file"),
										mimeTypes: z.array(z.string()),
									})
								)
						),
						outputPath: z.union([z.string(), z.null()]),
						outputType: IOType.or(z.literal("file")),
						outputMimeType: z.string().optional(), // only required for file outputs
						showOutput: z.boolean(),
					})
				),
				_id: z
					.string()
					.length(24)
					.regex(/^[0-9a-fA-F]{24}$/)
					.transform((val) => new ObjectId(val)),
				baseUrl: z.string().optional(),
				displayName: z.string(),
				color: z.union([
					z.literal("purple"),
					z.literal("blue"),
					z.literal("green"),
					z.literal("yellow"),
					z.literal("red"),
				]),
				icon: z.union([
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
				]),
				description: z.string(),
				isOnByDefault: z.optional(z.literal(true)),
				isLocked: z.optional(z.literal(true)),
				isHidden: z.optional(z.literal(true)),
			})
			.transform((val) => ({
				type: "config" as const,
				...val,
				functions: val.functions.map((fn) => ({ ...fn, call: getCallMethod(fn, val.baseUrl) })),
			}))
	)
	// add the extra hardcoded tools
	.transform((val) => [...val, calculator, directlyAnswer, fetchUrl, websearch]);

function getCallMethod(toolFn: Omit<ToolFunction, "call">, baseUrl?: string): BackendCall {
	return async function* (params, ctx) {
		if (toolFn.endpoint === null || !baseUrl) {
			throw new Error(`Tool function ${toolFn.name} has no endpoint`);
		}

		const ipToken = await getIpToken(ctx.ip, ctx.username);

		const outputs = await callSpace(
			baseUrl,
			toolFn.endpoint,
			toolFn.inputs.map((input) => {
				if (input.type === "file") {
					throw new Error("File inputs are not supported");
				}

				const value = params[input.name];
				if (value === undefined) {
					if (input.required) {
						throw new Error(`Missing required input ${input.name}`);
					}

					return input.default;
				}

				return value;
			}),
			ipToken
		);

		if (toolFn.outputPath === null) {
			throw new Error(`Tool function ${toolFn.name} has no output path`);
		}
		const files: MessageFile[] = [];

		const toolOutputs: Array<Record<string, string>> = [];

		await Promise.all(
			jp.query(outputs, toolFn.outputPath).map(async (output: string | string[], idx) => {
				if (toolFn.outputType === "file") {
					// output files are actually URLs
					const outputs = Array.isArray(output) ? output : [output];

					await Promise.all(
						outputs.map(async (output, idx) => {
							await fetch(output)
								.then((res) => res.blob())
								.then(async (blob) => {
									const fileType = blob.type.split("/")[1] ?? toolFn.outputMimeType?.split("/")[1];
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
						[toolFn.name + "-" + idx.toString()]:
							"A file has been generated. Answer as if the user can already see the image. Do not try to insert the image or to add space for it. The user can already see the image. Do not try to describe the image as you the model cannot see it. Be concise.",
					});
				} else {
					outputs.push({
						[toolFn.name + "-" + idx.toString()]: output,
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

		return { outputs: toolOutputs, display: toolFn.showOutput };
	};
}

export const toolFromConfigs = configTools.parse(JSON5.parse(env.TOOLS)) satisfies ConfigTool[];
