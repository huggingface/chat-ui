import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/config", () => ({ config: { GITHUB_TOKEN: "ghp_test_token" } }));

import { resetGithubCache } from "./client";
import { listRepos } from "./listRepos";
import { installGithubFetch, type GithubFetchMock, type Responder } from "./__fixtures__/mockFetch";

let mock: GithubFetchMock | undefined;
const install = (responder: Responder) => {
	mock = installGithubFetch(responder);
	return mock;
};

const repo = (name: string, stars: number, forks = 0) => ({
	full_name: `huggingface/${name}`,
	description: `The ${name} library`,
	stargazers_count: stars,
	forks_count: forks,
	language: "Python",
	html_url: `https://github.com/huggingface/${name}`,
	topics: ["nlp", "pytorch", "machine-learning", "jax", "transformers", "sixth"],
});

beforeEach(() => resetGithubCache());
afterEach(() => {
	mock?.restore();
	mock = undefined;
});

describe("listRepos", () => {
	it("ranks by stars server-side rather than sorting one arbitrary page", async () => {
		// The regression test for the original's worst bug: it fetched page one in
		// GitHub's default order (creation date) and sorted *that* by stars, so
		// {sort: "stars", limit: 10} answered "the 10 most-starred of the 100
		// most-recently-created" while presenting it as the top 10 overall.
		const recorder = install(({ path }) =>
			path.startsWith("/search/repositories")
				? { json: { items: [repo("transformers", 147203), repo("diffusers", 29441)] } }
				: undefined
		);

		const result = await listRepos({ owner: "huggingface", sort: "stars", limit: 10 });

		expect(recorder.paths).toHaveLength(1);
		expect(recorder.paths[0]).toContain("/search/repositories");
		expect(recorder.paths[0]).toContain("q=org%3Ahuggingface");
		expect(recorder.paths[0]).toContain("sort=stars");
		expect(recorder.paths[0]).toContain("order=desc");
		expect(result.text).toContain("huggingface/transformers");
		expect(result.text).toContain("147,203 stars");
	});

	it("uses the list endpoint for the sorts it supports server-side", async () => {
		const recorder = install(({ path }) =>
			path.startsWith("/orgs/huggingface/repos") ? { json: [repo("trl", 12000)] } : undefined
		);
		await listRepos({ owner: "huggingface", sort: "created", order: "asc" });

		expect(recorder.paths[0]).toContain("/orgs/huggingface/repos");
		expect(recorder.paths[0]).toContain("sort=created");
		expect(recorder.paths[0]).toContain("direction=asc");
	});

	it("asks for a bounded page by default instead of the whole org", async () => {
		// The original advertised a default of 30 and passed undefined, so a bare
		// {owner: "huggingface"} paged every repo in the org into the model's context.
		const recorder = install(({ path }) =>
			path.startsWith("/search/repositories") ? { json: { items: [repo("trl", 1)] } } : undefined
		);
		await listRepos({ owner: "huggingface" });

		expect(recorder.paths).toHaveLength(1);
		expect(recorder.paths[0]).toContain("per_page=30");
	});

	it("caps the limit", async () => {
		const recorder = install(({ path }) =>
			path.startsWith("/search/repositories") ? { json: { items: [repo("trl", 1)] } } : undefined
		);
		await listRepos({ owner: "huggingface", limit: 5000 });
		expect(recorder.paths[0]).toContain("per_page=100");
	});

	it("hits the users endpoint for a user owner", async () => {
		const recorder = install(({ path }) =>
			path.startsWith("/users/pngwn/repos") ? { json: [repo("thing", 3)] } : undefined
		);
		await listRepos({ owner: "pngwn", owner_type: "user", sort: "updated" });

		expect(recorder.paths[0]).toContain("/users/pngwn/repos");
	});

	it("scopes a starred search to the user when owner_type is user", async () => {
		const recorder = install(({ path }) =>
			path.startsWith("/search/repositories") ? { json: { items: [] } } : undefined
		);
		await listRepos({ owner: "pngwn", owner_type: "user" });
		expect(recorder.paths[0]).toContain("q=user%3Apngwn");
	});

	it("surfaces the rate limit with the time it resets", async () => {
		const reset = Math.floor(Date.now() / 1000) + 25 * 60;
		install(() => ({
			status: 403,
			json: { message: "API rate limit exceeded" },
			headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
		}));

		const result = await listRepos({ owner: "huggingface", sort: "created" });
		expect(result.isError).toBe(true);
		expect(result.text).toContain("rate limit");
		expect(result.text).toMatch(/about 25 minutes/);
	});

	it("says which owner_type to try when the name does not resolve", async () => {
		install(() => undefined);
		const result = await listRepos({ owner: "nobody", sort: "created" });
		expect(result.isError).toBe(true);
		expect(result.text).toContain("owner_type 'user'");
	});

	it("formats an entry with the hint the next tool accepts", async () => {
		install(({ path }) =>
			path.startsWith("/search/repositories")
				? { json: { items: [repo("transformers", 147203, 29441)] } }
				: undefined
		);
		const result = await listRepos({ owner: "huggingface" });

		expect(result.text).toContain("Use in tools: {'repo': 'huggingface/transformers'}");
		expect(result.text).toContain("🍴 29,441 forks");
		// Topics are capped at five so a repo cannot spend a paragraph on tags.
		expect(result.text).toContain("Topics: nlp, pytorch, machine-learning, jax, transformers");
		expect(result.text).not.toContain("sixth");
	});

	it("truncates a long description", async () => {
		install(({ path }) =>
			path.startsWith("/search/repositories")
				? {
						json: {
							items: [{ ...repo("transformers", 1), description: "d".repeat(200) }],
						},
					}
				: undefined
		);
		const result = await listRepos({ owner: "huggingface" });
		expect(result.text).toContain(`${"d".repeat(100)}…`);
		expect(result.text).not.toContain("d".repeat(101));
	});

	it("reports an empty result without calling it a failure", async () => {
		install(({ path }) =>
			path.startsWith("/search/repositories") ? { json: { items: [] } } : undefined
		);
		const result = await listRepos({ owner: "huggingface" });
		expect(result.isError).toBe(false);
		expect(result.text).toContain("No repositories found");
	});

	it("requires an owner", async () => {
		const result = await listRepos({});
		expect(result.isError).toBe(true);
		expect(result.text).toContain("`owner` is required");
	});

	it("tolerates an owner/repo paste in the owner field", async () => {
		const recorder = install(({ path }) =>
			path.startsWith("/search/repositories") ? { json: { items: [] } } : undefined
		);
		await listRepos({ owner: "huggingface/trl" });
		expect(recorder.paths[0]).toContain("q=org%3Ahuggingface");
	});
});
