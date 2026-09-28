import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { BadRequestError } from "openai";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { EndpointParameters } from "$lib/server/endpoints/endpoints";
import type { AttachmentReport } from "./utils/attachmentBudget";
import { generate } from "./generate";

const report = (shown: number): AttachmentReport => ({
	newest: 0,
	texts: [{ index: 0, name: "data.csv", total: 8_000_000, shown }],
	images: [],
});

const contextError = () =>
	new BadRequestError(
		400,
		{ message: "This model's maximum context length is 1048576 tokens." },
		undefined,
		{}
	);

async function* answer(text: string) {
	yield { token: { id: 0, text, special: false, logprob: 0 }, generated_text: null, details: null };
	yield {
		token: { id: 1, text: "", special: true, logprob: 0 },
		generated_text: text,
		details: null,
	};
}

function endpointRefusing(times: number) {
	let calls = 0;
	return vi.fn(async (params: EndpointParameters) => {
		const minimal = params.attachments === "minimal";
		params.onAttachments?.(report(minimal ? 5_000 : 150_000));
		calls += 1;
		if (calls <= times) throw contextError();
		return answer("ok");
	});
}

async function run(endpoint: ReturnType<typeof endpointRefusing>) {
	const updates: MessageUpdate[] = [];
	const ctx = {
		model: { id: "m", name: "m", parameters: {} },
		endpoint,
		conv: { _id: new ObjectId(), messages: [] },
		messages: [{ from: "user", content: "summarise" }],
		promptedAt: new Date(),
		abortController: new AbortController(),
		locals: undefined,
	} as unknown as Parameters<typeof generate>[0];
	for await (const update of generate(ctx)) updates.push(update);
	return updates;
}

describe("generate without tools", () => {
	it("retries once with attachments cut when the provider refuses the size", async () => {
		const endpoint = endpointRefusing(1);

		const updates = await run(endpoint);

		expect(endpoint.mock.calls.map(([params]) => params.attachments)).toEqual([
			"budget",
			"minimal",
		]);
		expect(updates[0]).toEqual({
			type: MessageUpdateType.Notice,
			text: "The model refused the request as too large, so it was sent again with attachments cut: data.csv to its first 5,000 of 8,000,000 characters.",
		});
		expect(updates.at(-1)).toMatchObject({ type: MessageUpdateType.FinalAnswer, text: "ok" });
	});

	it("names the attachment when the retry is refused too", async () => {
		const endpoint = endpointRefusing(2);

		await expect(run(endpoint)).rejects.toThrow(
			"This conversation is too large for the model, even with its attachments cut down: data.csv (8,000,000 characters)."
		);
		expect(endpoint).toHaveBeenCalledTimes(2);
	});

	it("tells the user when the file just sent went out cut to the budget", async () => {
		const endpoint = endpointRefusing(0);

		const updates = await run(endpoint);

		expect(endpoint).toHaveBeenCalledTimes(1);
		expect(updates[0]).toEqual({
			type: MessageUpdateType.Notice,
			text: "data.csv is too long to send whole: the model sees 150,000 of its 8,000,000 characters, from the start and the end.",
		});
	});
});
