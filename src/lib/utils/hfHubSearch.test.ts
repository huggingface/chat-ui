import { describe, expect, it, vi } from "vitest";
import {
	findHfHubMention,
	parseHfHubQuicksearch,
	replaceHfHubMention,
	searchHfHub,
} from "./hfHubSearch";

describe("Hugging Face Hub mentions", () => {
	it("finds a partial repo name at the caret", () => {
		expect(findHfHubMention("Compare @distilb", 16)).toEqual({
			query: "distilb",
			start: 8,
			end: 16,
		});
	});

	it("accepts namespaced repo IDs and includes the rest of the token", () => {
		expect(findHfHubMention("Try @distilbert/distilbert-base", 12)).toEqual({
			query: "distilb",
			start: 4,
			end: 31,
		});
	});

	it("does not treat email addresses as Hub mentions", () => {
		expect(findHfHubMention("Email me@example.com", 20)).toBeNull();
	});

	it("replaces only the active mention and positions the caret after it", () => {
		const value = "Compare @distilb with BERT";
		const mention = findHfHubMention(value, 16);
		expect(mention).not.toBeNull();
		if (!mention) return;

		expect(replaceHfHubMention(value, mention, "distilbert/distilbert-base-uncased")).toEqual({
			value: "Compare @distilbert/distilbert-base-uncased with BERT",
			caret: 43,
		});
	});

	it("adds a trailing space at the end of a prompt but preserves punctuation", () => {
		const atEnd = findHfHubMention("Use @bert", 9);
		const beforeComma = findHfHubMention("Use @bert, please", 9);
		expect(atEnd && replaceHfHubMention("Use @bert", atEnd, "google-bert/bert-base-cased")).toEqual(
			{
				value: "Use @google-bert/bert-base-cased ",
				caret: 33,
			}
		);
		expect(
			beforeComma &&
				replaceHfHubMention("Use @bert, please", beforeComma, "google-bert/bert-base-cased")
		).toEqual({
			value: "Use @google-bert/bert-base-cased, please",
			caret: 32,
		});
	});
});

describe("Hugging Face Hub quicksearch", () => {
	it("keeps models, datasets, and Spaces in category order", () => {
		expect(
			parseHfHubQuicksearch({
				models: [{ id: "distilbert/distilbert-base-uncased" }],
				datasets: [{ id: "sentence-transformers/msmarco-distilbert" }],
				spaces: [{ id: "docs-demos/distilbert", emoji: "🌍" }],
				users: [{ user: "distilbert-mail" }],
				orgs: [{ name: "distilbert" }],
			})
		).toEqual([
			{ id: "distilbert/distilbert-base-uncased", type: "model" },
			{ id: "sentence-transformers/msmarco-distilbert", type: "dataset" },
			{ id: "docs-demos/distilbert", type: "space", emoji: "🌍" },
		]);
	});

	it("limits each category and ignores malformed entries", () => {
		const models = Array.from({ length: 7 }, (_, index) => ({ id: `model-${index}` }));
		expect(parseHfHubQuicksearch({ models: [null, ...models] })).toEqual(
			models.slice(0, 5).map(({ id }) => ({ id, type: "model" }))
		);
	});

	it("queries the public quicksearch endpoint", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(JSON.stringify({ models: [{ id: "distilbert/base" }] }), { status: 200 })
			);

		await expect(searchHfHub("distilbert", undefined, fetcher)).resolves.toEqual([
			{ id: "distilbert/base", type: "model" },
		]);
		expect(fetcher).toHaveBeenCalledOnce();
		const [url, init] = fetcher.mock.calls[0];
		expect(String(url)).toBe("https://huggingface.co/api/quicksearch?q=distilbert&limit=5");
		expect(init).toEqual({ signal: undefined });
	});

	it("rejects unsuccessful responses", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
		await expect(searchHfHub("bert", undefined, fetcher)).rejects.toThrow("status 503");
	});
});
