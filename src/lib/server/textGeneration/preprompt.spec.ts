import { describe, expect, it } from "vitest";
import { resolvePreprompt } from "./preprompt";
import { injectArtifactsPrompt } from "./artifacts";
import {
	ML_ASSISTANT_BUDGET_RULES,
	ML_ASSISTANT_PREPROMPT,
	mlAssistantSessionContext,
} from "$lib/server/mlAssistantPrompt";

/**
 * The ML Assistant preset must not change how artifacts resolve for anything
 * else. `legacy` is the expression this replaced, kept here verbatim so the
 * non-preset half of the matrix is pinned to the old behaviour.
 */
const legacy = (
	conversationPreprompt: string | undefined,
	artifactsOverride: boolean | undefined,
	supportsArtifacts: boolean | undefined
) =>
	(artifactsOverride ?? supportsArtifacts)
		? injectArtifactsPrompt(conversationPreprompt)
		: conversationPreprompt;

const PREPROMPTS = [undefined, "", "You are a pirate."];
const OVERRIDES = [undefined, true, false];
const SUPPORTS = [undefined, true, false];

describe("resolvePreprompt", () => {
	it("leaves every non-preset case exactly as it was before the preset existed", () => {
		for (const conversationPreprompt of PREPROMPTS) {
			for (const artifactsOverride of OVERRIDES) {
				for (const supportsArtifacts of SUPPORTS) {
					expect(
						resolvePreprompt({
							conversationPreprompt,
							mlAssistant: false,
							artifactsOverride,
							supportsArtifacts,
						}),
						`preprompt=${conversationPreprompt} override=${artifactsOverride} supports=${supportsArtifacts}`
					).toBe(legacy(conversationPreprompt, artifactsOverride, supportsArtifacts));
				}
			}
		}
	});

	it("still gives artifacts to a model that supports them, with no preset in sight", () => {
		const resolved = resolvePreprompt({
			conversationPreprompt: "You are a pirate.",
			mlAssistant: false,
			supportsArtifacts: true,
		});

		expect(resolved).toContain("You are a pirate.");
		expect(resolved).toBe(injectArtifactsPrompt("You are a pirate."));
		expect(resolved).not.toContain(ML_ASSISTANT_PREPROMPT);
	});

	it("still withholds artifacts from a model that does not support them", () => {
		expect(
			resolvePreprompt({
				conversationPreprompt: "You are a pirate.",
				mlAssistant: false,
				supportsArtifacts: false,
			})
		).toBe("You are a pirate.");
	});

	it("lets the per-model override win in both directions outside the preset", () => {
		expect(
			resolvePreprompt({
				conversationPreprompt: "base",
				mlAssistant: false,
				artifactsOverride: false,
				supportsArtifacts: true,
			})
		).toBe("base");

		expect(
			resolvePreprompt({
				conversationPreprompt: "base",
				mlAssistant: false,
				artifactsOverride: true,
				supportsArtifacts: false,
			})
		).toBe(injectArtifactsPrompt("base"));
	});

	it("replaces the conversation prompt with the preset, not per model", () => {
		const resolved = resolvePreprompt({
			conversationPreprompt: "You are a pirate.",
			mlAssistant: true,
			supportsArtifacts: false,
		});

		expect(resolved).toContain(ML_ASSISTANT_PREPROMPT);
		expect(resolved).not.toContain("You are a pirate.");
	});

	it("force-enables artifacts for the preset even when the model and override say no", () => {
		const now = new Date("2026-08-24T09:07:00Z");

		expect(
			resolvePreprompt({
				conversationPreprompt: undefined,
				mlAssistant: true,
				artifactsOverride: false,
				supportsArtifacts: false,
				timezone: "UTC",
				now,
			})
		).toBe(
			`${injectArtifactsPrompt(ML_ASSISTANT_PREPROMPT)}\n\n${ML_ASSISTANT_BUDGET_RULES}\n\n${mlAssistantSessionContext(
				{
					timezone: "UTC",
					now,
					budget: { remaining: "$0.00", total: "$0.00" },
				}
			)}`
		);
	});

	it("stamps the session context last, where the namespace rule reads it", () => {
		const resolved = resolvePreprompt({
			conversationPreprompt: undefined,
			mlAssistant: true,
			username: "pngwn",
			timezone: "UTC",
			now: new Date("2026-08-24T09:07:00Z"),
		});

		expect(resolved).toContain("User=pngwn");
		// The bracketed context stays the message's final line: the namespace rule
		// keys off it, and artifacts is appended by the same call.
		expect(resolved?.trimEnd().endsWith("]")).toBe(true);
		expect(resolved?.trimEnd().split("\n").at(-1)).toContain("User=pngwn");
	});

	it("says the user is unknown rather than leaving the preset to guess", () => {
		expect(resolvePreprompt({ conversationPreprompt: undefined, mlAssistant: true })).toContain(
			"User=unknown"
		);
	});

	it("stamps nothing outside the preset", () => {
		expect(
			resolvePreprompt({
				conversationPreprompt: "You are a pirate.",
				mlAssistant: false,
				username: "pngwn",
			})
		).toBe("You are a pirate.");
	});

	it("carries the live balance in the session context", () => {
		const budget = {
			totalMicroUsd: 10_000_000,
			spentMicroUsd: 1_500_000,
			reservations: [
				{
					key: "gen:a",
					kind: "job" as const,
					flavor: "t4-small",
					priceMicroUsdPerMinute: 6667,
					timeoutSeconds: 600,
					ceilingMicroUsd: 1_000_000,
					createdAt: new Date(),
				},
			],
		};
		const resolved = resolvePreprompt({
			conversationPreprompt: undefined,
			mlAssistant: true,
			username: "pngwn",
			budget,
		});
		expect(resolved).toContain("# Session budget");
		// total − spent − held = 10.00 − 1.50 − 1.00
		expect(resolved).toContain("Budget=$7.50 remaining of $10.00");
	});

	it("treats a conversation without a stored budget as a zero grant, not an ungated one", () => {
		const resolved = resolvePreprompt({
			conversationPreprompt: undefined,
			mlAssistant: true,
			username: "pngwn",
		});
		expect(resolved).toContain("# Session budget");
		expect(resolved).toContain("Budget=$0.00 remaining of $0.00");

		const outsideMode = resolvePreprompt({
			conversationPreprompt: "You are a pirate.",
			mlAssistant: false,
		});
		expect(outsideMode).not.toContain("# Session budget");
		expect(outsideMode).not.toContain("Budget=");
	});
});
