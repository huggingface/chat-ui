import { describe, expect, it } from "vitest";
import { mergeFinalAnswer, mergeFinalAnswerWithPrefix } from "./mergeFinalAnswer";
import { mergeRouterMetadata } from "./mergeRouterMetadata";

describe("conversation generation parity contracts", () => {
	it("keeps client/server final-answer merge behavior aligned", () => {
		const vectors = [
			{
				prefix: "",
				current: "draft",
				finalText: "final",
				interrupted: false,
				hadTools: false,
			},
			{
				prefix: "preface\n",
				current: "draft",
				finalText: "final",
				interrupted: false,
				hadTools: true,
			},
			{
				prefix: "preface\n",
				current: "already streamed",
				finalText: "already streamed",
				interrupted: false,
				hadTools: true,
			},
			{
				prefix: "preface\n",
				current: "partial",
				finalText: "provider",
				interrupted: true,
				hadTools: false,
			},
		];

		for (const vector of vectors) {
			const serverResult = mergeFinalAnswerWithPrefix({
				prefixContent: vector.prefix,
				currentContent: `${vector.prefix}${vector.current}`,
				finalText: vector.finalText,
				interrupted: vector.interrupted,
				hadTools: vector.hadTools,
			});

			const clientResult = `${vector.prefix}${mergeFinalAnswer({
				currentContent: vector.current,
				finalText: vector.finalText,
				interrupted: vector.interrupted,
				hadTools: vector.hadTools,
			})}`;

			expect(serverResult).toBe(clientResult);
		}
	});

	it("keeps router metadata merge behavior aligned across sequential updates", () => {
		const updates = [
			{ route: "router-a", model: "model-a" },
			{ route: "", model: "", provider: "hf-inference" as never },
			{ route: "router-b", model: "model-b" },
			{ route: "", model: "", provider: "cerebras" as never },
		];

		let serverMetadata = undefined;
		let clientMetadata = undefined;

		for (const update of updates) {
			serverMetadata = mergeRouterMetadata(serverMetadata, update);
			clientMetadata = mergeRouterMetadata(clientMetadata, update);
			expect(serverMetadata).toEqual(clientMetadata);
		}
	});
});
