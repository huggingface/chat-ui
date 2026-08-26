import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";

// The gate itself is real; only the build flag behind it is forced on.
vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/config", () => ({ config: { GITHUB_TOKEN: "ghp_test_token" } }));
vi.mock("$lib/server/database", () => ({
	collections: { conversations: { updateOne: vi.fn() } },
}));
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { config } = await import("$lib/server/config");
const { githubGroundingBuiltins } = await import("./githubGrounding");
const { getEnabledBuiltinTools } = await import("./index");
const { resetGithubCache } = await import("$lib/server/github/client");
const { installGithubFetch } = await import("$lib/server/github/__fixtures__/mockFetch");

type Mock = ReturnType<typeof installGithubFetch>;
let mock: Mock | undefined;

const setToken = (value: string) =>
	((config as unknown as { GITHUB_TOKEN: string }).GITHUB_TOKEN = value);

const builtin = (name: string) => {
	const tool = githubGroundingBuiltins().find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`${name} was not offered`);
	return tool;
};

beforeEach(() => {
	resetGithubCache();
	setToken("ghp_test_token");
});
afterEach(() => {
	mock?.restore();
	mock = undefined;
	setToken("ghp_test_token");
});

describe("githubGroundingBuiltins", () => {
	it("offers the chain coarse to fine", () => {
		expect(githubGroundingBuiltins().map((tool) => tool.name)).toEqual([
			"github_list_repos",
			"github_find_examples",
			"github_read_file",
		]);
	});

	it("offers nothing without a token", () => {
		setToken("");
		expect(githubGroundingBuiltins()).toEqual([]);
	});

	it("exempts the two tools that precede writing code, but not discovery", () => {
		// The blanket restraint names writing code as a case to answer directly, so
		// without the exemption it contradicts the doctrine sitting under it.
		const exempt = githubGroundingBuiltins()
			.filter((tool) => tool.exemptFromToolRestraint)
			.map((tool) => tool.name);
		expect(exempt).toEqual(["github_find_examples", "github_read_file"]);
	});

	it("states the doctrine once, on the tool the chain starts at", () => {
		const withPrompt = githubGroundingBuiltins().filter((tool) => tool.preprompt);
		expect(withPrompt.map((tool) => tool.name)).toEqual(["github_find_examples"]);
		// It has to state the failure mode, not the capability — that is what moves a
		// model that already believes it knows the API.
		expect(withPrompt[0].preprompt).toMatch(/out of date/);
		expect(withPrompt[0].preprompt).toMatch(/fail at import time/);
		expect(withPrompt[0].preprompt).toMatch(/training job/);
	});

	it("never parks, so it cannot consume the round's single parking slot", () => {
		for (const tool of githubGroundingBuiltins()) {
			expect(tool.mayPark).toBeUndefined();
		}
	});

	it("returns a result as resultText and a failure as error", async () => {
		mock = installGithubFetch(({ path }) =>
			path.startsWith("/search/repositories")
				? { json: { items: [{ full_name: "huggingface/trl", stargazers_count: 1 }] } }
				: undefined
		);
		const listRepos = builtin("github_list_repos");

		const ok = await listRepos.execute({ owner: "huggingface" }, { uuid: "u", toolCallId: "c" });
		expect(ok).toMatchObject({ resultText: expect.stringContaining("huggingface/trl") });

		const bad = await listRepos.execute({}, { uuid: "u", toolCallId: "c" });
		expect(bad).toMatchObject({ error: expect.stringContaining("`owner` is required") });
	});

	it("passes the run's abort signal through to the request", async () => {
		// These are the first builtins that do network I/O; without the signal a 30s
		// call keeps running long after its result has been discarded.
		mock = installGithubFetch(() => ({ json: { items: [] } }));
		const controller = new AbortController();
		controller.abort();
		const result = await builtin("github_list_repos").execute(
			{ owner: "huggingface" },
			{ uuid: "u", toolCallId: "c", abortSignal: controller.signal }
		);
		expect(result).toMatchObject({ error: expect.stringContaining("Aborted") });
	});
});

describe("registration", () => {
	it("joins the preset's other builtin tools in a mode conversation", () => {
		expect(
			getEnabledBuiltinTools({ conv: { _id: new ObjectId(), mlAssistant: true } }).map(
				(t) => t.name
			)
		).toEqual([
			"ask_user_question",
			"update_plan",
			"wait",
			"github_list_repos",
			"github_find_examples",
			"github_read_file",
		]);
	});

	it("stays out of a conversation that is not in the mode, token or not", () => {
		expect(getEnabledBuiltinTools({ conv: { _id: new ObjectId() } })).toEqual([]);
	});

	it("leaves the other builtins alone when there is no token", () => {
		setToken("");
		expect(
			getEnabledBuiltinTools({ conv: { _id: new ObjectId(), mlAssistant: true } }).map(
				(t) => t.name
			)
		).toEqual(["ask_user_question", "update_plan", "wait"]);
	});
});
