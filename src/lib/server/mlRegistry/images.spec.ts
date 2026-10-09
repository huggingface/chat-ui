import { describe, expect, it } from "vitest";
import type { Message } from "$lib/types/Message";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { listToolImages } from "./images";

const CAT = "c".repeat(64);
const DOG = "d".repeat(64);
const PLOT = "e".repeat(64);
const REPO = "hf://models/pngwn/lora/benchmarks";

const image = (sha: string, mimeType = "image/jpeg") => ({ type: "image", mimeType, sha });

const call = (uuid: string, name: string, args: unknown) => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Call,
	uuid,
	call: { name, parameters: {} },
	argumentsRaw: JSON.stringify(args),
});

const result = (uuid: string, name: string, content: unknown[]) => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Result,
	uuid,
	result: {
		status: ToolResultStatus.Success,
		call: { name, parameters: {} },
		outputs: [{ text: "attached", content }],
		display: true,
	},
});

const attach = (...uris: string[]) => ({
	operations: uris.map((uri) => ({ cmd: "attach", args: [uri] })),
});

const message = (...updates: unknown[]) => ({ updates }) as unknown as Message;

describe("listToolImages", () => {
	it("names each attached image by the uri it was read from", () => {
		const images = listToolImages([
			message(
				call("u1", "hf_fs", attach(`${REPO}/sheet_cat.jpg`, `${REPO}/sheet_dog.jpg`)),
				result("u1", "hf_fs", [image(CAT), image(DOG)])
			),
		]);
		expect(images).toEqual([
			{
				sha: DOG,
				mimeType: "image/jpeg",
				tool: "hf_fs",
				source: `${REPO}/sheet_dog.jpg`,
				count: 1,
			},
			{
				sha: CAT,
				mimeType: "image/jpeg",
				tool: "hf_fs",
				source: `${REPO}/sheet_cat.jpg`,
				count: 1,
			},
		]);
	});

	it("lists an image returned again once, counted, and moved to the front", () => {
		const images = listToolImages([
			message(
				call("u1", "hf_fs", attach(`${REPO}/sheet_cat.jpg`)),
				result("u1", "hf_fs", [image(CAT)])
			),
			message(call("u2", "plot", {}), result("u2", "plot", [image(PLOT, "image/png")])),
			message(
				call("u3", "hf_fs", attach(`${REPO}/copy_of_cat.jpg`)),
				result("u3", "hf_fs", [image(CAT)])
			),
		]);
		expect(images.map((i) => [i.sha, i.count, i.source])).toEqual([
			[CAT, 2, `${REPO}/copy_of_cat.jpg`],
			[PLOT, 1, undefined],
		]);
	});

	it("names no source when the attaches and images do not pair up", () => {
		const images = listToolImages([
			message(
				call("u1", "hf_fs", {
					operations: [
						{ cmd: "attach", args: [`${REPO}/sheet_cat.jpg`] },
						{ cmd: "attach", args: [`${REPO}/missing.jpg`] },
					],
				}),
				result("u1", "hf_fs", [image(CAT)])
			),
		]);
		expect(images).toEqual([{ sha: CAT, mimeType: "image/jpeg", tool: "hf_fs", count: 1 }]);
	});

	it("leaves out images still inline, failed results and other blocks", () => {
		const failed = result("u2", "hf_fs", [image(DOG)]);
		failed.result.status = ToolResultStatus.Error;
		const images = listToolImages([
			message(
				call("u1", "hf_fs", attach(`${REPO}/a.jpg`)),
				result("u1", "hf_fs", [
					{ type: "image", mimeType: "image/jpeg", data: "aGk=" },
					{ type: "resource", uri: "hf://x" },
				]),
				failed
			),
		]);
		expect(images).toEqual([]);
	});
});
