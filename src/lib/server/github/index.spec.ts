import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/config", () => ({ config: { GITHUB_TOKEN: "ghp_test_token" } }));

import { config } from "$lib/server/config";
import { resetGithubCache } from "./client";
import {
	GITHUB_FIND_EXAMPLES,
	GITHUB_LIST_REPOS,
	GITHUB_READ_FILE,
	githubTools,
	runGithubTool,
} from "./index";
import { installGithubFetch, type GithubFetchMock } from "./__fixtures__/mockFetch";

let mock: GithubFetchMock | undefined;
const setToken = (value: string) =>
	((config as unknown as { GITHUB_TOKEN: string }).GITHUB_TOKEN = value);

beforeEach(() => {
	resetGithubCache();
	setToken("ghp_test_token");
});
afterEach(() => {
	mock?.restore();
	mock = undefined;
	setToken("ghp_test_token");
});

describe("githubTools", () => {
	it("offers the three tools, coarse to fine", () => {
		expect(githubTools().map((tool) => tool.function.name)).toEqual([
			GITHUB_LIST_REPOS,
			GITHUB_FIND_EXAMPLES,
			GITHUB_READ_FILE,
		]);
	});

	it("offers nothing without a token", () => {
		// A tool that is advertised and always fails costs a turn to discover.
		setToken("");
		expect(githubTools()).toEqual([]);
	});

	it("names the chain and the failure mode in the descriptions, not just the capability", () => {
		// These descriptions are the only thing enforcing the workflow, so they are
		// behaviour. "Your knowledge is out of date" moves a model that "finds example
		// files" does not.
		const byName = Object.fromEntries(
			githubTools().map((tool) => [tool.function.name, tool.function.description])
		);

		expect(byName[GITHUB_FIND_EXAMPLES]).toMatch(/out of date/i);
		expect(byName[GITHUB_FIND_EXAMPLES]).toContain(GITHUB_READ_FILE);
		expect(byName[GITHUB_READ_FILE]).toContain(GITHUB_FIND_EXAMPLES);
		expect(byName[GITHUB_LIST_REPOS]).toContain(GITHUB_FIND_EXAMPLES);
		// Every one carries a negative case, which is what stops a model calling
		// find_examples when it already has the path.
		for (const description of Object.values(byName)) {
			expect(description).toMatch(/When NOT to use/);
		}
	});

	it("marks only `repo` required on find_examples, so a keyword is optional", () => {
		const tool = githubTools().find((t) => t.function.name === GITHUB_FIND_EXAMPLES);
		expect(tool?.function.parameters.required).toEqual(["repo"]);
	});
});

describe("runGithubTool", () => {
	it("dispatches to the named handler", async () => {
		mock = installGithubFetch(({ path }) =>
			path.startsWith("/search/repositories")
				? { json: { items: [{ full_name: "huggingface/trl", stargazers_count: 1 }] } }
				: undefined
		);
		const result = await runGithubTool(GITHUB_LIST_REPOS, { owner: "huggingface" });
		expect(result.text).toContain("huggingface/trl");
	});

	it("turns an unexpected throw into readable text", async () => {
		// Nothing here should throw, but if something does the model must still get a
		// sentence rather than a rejected promise it cannot act on.
		const previous = globalThis.fetch;
		globalThis.fetch = (() => {
			throw new TypeError("boom");
		}) as typeof fetch;
		try {
			const result = await runGithubTool(GITHUB_FIND_EXAMPLES, { repo: "trl" });
			expect(result.isError).toBe(true);
			expect(result.text).toContain("Could not reach the GitHub API");
		} finally {
			globalThis.fetch = previous;
		}
	});

	it("reports an unknown name instead of throwing", async () => {
		const result = await runGithubTool("github_nope", {});
		expect(result.isError).toBe(true);
		expect(result.text).toContain("Unknown GitHub tool");
	});
});
