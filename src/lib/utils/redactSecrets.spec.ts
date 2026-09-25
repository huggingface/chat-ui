import { describe, expect, it } from "vitest";
import { redactToolArguments } from "./redactSecrets";

describe("redactToolArguments", () => {
	it("hides every string under a secret-named key, however it is prefixed", () => {
		expect(
			redactToolArguments({
				secrets: { HF_TOKEN: "$HF_TOKEN", nested: ["a", { b: "c" }] },
				WANDB_API_KEY: "wandb-1234",
				db_password: "hunter2",
			})
		).toEqual({
			secrets: { HF_TOKEN: "<redacted>", nested: ["<redacted>", { b: "<redacted>" }] },
			WANDB_API_KEY: "<redacted>",
			db_password: "<redacted>",
		});
	});

	it("keeps numbers and ordinary keys that only contain a secret word", () => {
		const args = { max_tokens: 512, tokenizer: "gpt2", tokens_per_step: 8, dry_run: true };
		expect(redactToolArguments(args)).toEqual(args);
	});

	it("runs every other string through the text patterns", () => {
		expect(
			redactToolArguments({ commands: ["echo hi", "curl -H 'Authorization: Bearer abcdefgh123'"] })
		).toEqual({ commands: ["echo hi", "curl -H 'Authorization: <redacted>'"] });
	});
});
