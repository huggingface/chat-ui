import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/config", () => ({ config: { GITHUB_TOKEN: "ghp_test_token" } }));

import { resetGithubCache } from "./client";
import { bestPatternPriority, findExamples, rankExamples } from "./findExamples";
import {
	installGithubFetch,
	treeResponse,
	type GithubFetchMock,
	type Responder,
} from "./__fixtures__/mockFetch";

const COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHORT = COMMIT.slice(0, 7);

/** A slice of a real TRL tree: runnable scripts, notebooks, library internals and tests. */
const TRL_TREE = [
	"README.md",
	"setup.py",
	"examples/scripts/sft.py",
	"examples/scripts/dpo.py",
	"examples/scripts/grpo_trainer.py",
	"examples/scripts/evals/judge_tldr.py",
	"examples/notebooks/best_of_n.ipynb",
	"examples/notebooks/gpt2-sentiment.ipynb",
	"examples/accelerate_configs/deepspeed_zero3.yaml",
	"trl/trainer/sft_trainer.py",
	"trl/trainer/grpo_trainer.py",
	"tests/test_sft_trainer.py",
	"docs/source/sft_trainer.mdx",
	"docs/tutorials/deep/nested/thing.py",
	"scripts/generate_zero_shot.py",
];

let mock: GithubFetchMock | undefined;

const install = (responder: Responder) => {
	mock = installGithubFetch(responder);
	return mock;
};

/** The happy path every test starts from: repo exists, branch resolves, tree returns. */
const trlResponder =
	(tree: ReturnType<typeof treeResponse> = treeResponse(TRL_TREE)): Responder =>
	({ path }) => {
		if (path === "/repos/huggingface/trl") return { json: { default_branch: "main" } };
		if (path === "/repos/huggingface/trl/git/ref/heads/main") {
			return { json: { object: { sha: COMMIT } } };
		}
		if (path.startsWith(`/repos/huggingface/trl/git/trees/${COMMIT}`)) return { json: tree };
		return undefined;
	};

beforeEach(() => resetGithubCache());
afterEach(() => {
	mock?.restore();
	mock = undefined;
});

describe("bestPatternPriority", () => {
	it("prefers the deepest matching segment, not the first", () => {
		// "scripts" (rank 0) is the more specific claim than "examples" (rank 1).
		expect(bestPatternPriority(["examples", "scripts", "train.py"])).toBe(0);
		expect(bestPatternPriority(["examples", "notebooks", "x.ipynb"])).toBe(3);
	});

	it("matches a whole segment, never part of one", () => {
		expect(bestPatternPriority(["src", "demo.py"])).toBe(Number.POSITIVE_INFINITY);
		expect(bestPatternPriority(["src", "demo", "app.py"])).toBe(15);
	});
});

describe("rankExamples", () => {
	const entries = TRL_TREE.map((path) => ({ path, size: 100 }));

	it("ranks runnable scripts above notebooks and above deeper paths", () => {
		const ranked = rankExamples(entries, "", 0).map((file) => file.path);
		expect(ranked[0]).toBe("examples/scripts/dpo.py");
		expect(ranked.indexOf("examples/scripts/sft.py")).toBeLessThan(
			ranked.indexOf("examples/notebooks/best_of_n.ipynb")
		);
		expect(ranked.indexOf("examples/notebooks/best_of_n.ipynb")).toBeLessThan(
			ranked.indexOf("docs/tutorials/deep/nested/thing.py")
		);
	});

	it("keeps library internals and tests out of the listing", () => {
		const ranked = rankExamples(entries, "", 0).map((file) => file.path);
		expect(ranked).not.toContain("trl/trainer/sft_trainer.py");
		expect(ranked).not.toContain("tests/test_sft_trainer.py");
		expect(ranked).not.toContain("setup.py");
	});

	it("puts the keyword's own script first", () => {
		expect(rankExamples(entries, "sft", 60)[0].path).toBe("examples/scripts/sft.py");
		expect(rankExamples(entries, "grpo", 60)[0].path).toBe("examples/scripts/grpo_trainer.py");
	});

	it("matches a phrase as well as an abbreviation", () => {
		const ranked = rankExamples(entries, "notebook", 60).map((file) => file.path);
		expect(ranked).toContain("examples/notebooks/best_of_n.ipynb");
	});

	it("puts what you can run above what merely sits beside it", () => {
		// The layout that motivated this: current TRL has no examples/scripts/, so
		// ordering on directory shape alone answers a bare listing with the README and
		// eight accelerate configs before any Python at all.
		const modern = [
			"examples/README.md",
			"examples/accelerate_configs/deepspeed_zero3.yaml",
			"examples/accelerate_configs/fsdp1.yaml",
			"examples/sft_gemma3/sft_gemma3.py",
			"examples/sft_gpt_oss/sft_gpt_oss.py",
		].map((path) => ({ path, size: 100 }));

		expect(rankExamples(modern, "", 0).map((file) => file.path)).toEqual([
			"examples/sft_gemma3/sft_gemma3.py",
			"examples/sft_gpt_oss/sft_gpt_oss.py",
			"examples/README.md",
			"examples/accelerate_configs/deepspeed_zero3.yaml",
			"examples/accelerate_configs/fsdp1.yaml",
		]);
	});

	it("prefers the runnable file when two score the same on a keyword", () => {
		const pair = [
			{ path: "examples/configs/sft.yaml", size: 100 },
			{ path: "examples/configs/sft.py", size: 100 },
		];
		expect(rankExamples(pair, "sft", 60)[0].path).toBe("examples/configs/sft.py");
	});

	it("still ranks a canonical scripts directory above notebooks and deeper paths", () => {
		const ranked = rankExamples(entries, "", 0).map((file) => file.path);
		expect(ranked.indexOf("examples/scripts/sft.py")).toBeLessThan(
			ranked.indexOf("examples/notebooks/best_of_n.ipynb")
		);
	});
});

describe("findExamples", () => {
	it("lists examples, best first, pinned to a commit", async () => {
		install(trlResponder());
		const result = await findExamples({ repo: "trl" });

		expect(result.isError).toBe(false);
		expect(result.text).toContain("examples/scripts/sft.py");
		expect(result.text).toContain(`Tree read at commit ${SHORT} (branch main)`);
		expect(result.text).not.toContain("trl/trainer/sft_trainer.py");
	});

	it("emits a read hint that github_read_file accepts verbatim", async () => {
		install(trlResponder());
		const result = await findExamples({ repo: "trl", keyword: "sft" });

		// The hint bridges this tool's arguments to the next one's — the composition
		// step the model gets wrong when it has to reassemble them itself.
		expect(result.text).toContain(
			`To read, use: {'repo': 'huggingface/trl', 'path': 'examples/scripts/sft.py', 'ref': '${SHORT}'}`
		);
	});

	it("pins the ref to a commit rather than a blob sha", async () => {
		// A blob sha is the file's content hash and is not a commit-ish, so passing the
		// printed value to github_read_file's `ref` 404s. This is the regression test.
		install(({ path }) => {
			if (path === "/repos/huggingface/trl") return { json: { default_branch: "main" } };
			if (path === "/repos/huggingface/trl/git/ref/heads/main") {
				return { json: { object: { sha: COMMIT } } };
			}
			if (path.startsWith(`/repos/huggingface/trl/git/trees/${COMMIT}`)) {
				return {
					json: {
						truncated: false,
						tree: [{ path: "examples/scripts/sft.py", type: "blob", size: 12481, sha: "beefbeef" }],
					},
				};
			}
			return undefined;
		});
		const result = await findExamples({ repo: "trl" });
		expect(result.text).toContain(SHORT);
		expect(result.text).not.toContain("beefbeef");
	});

	it("never abbreviates a branch name as though it were a commit", async () => {
		// Slicing to 7 turns a default branch called `development` into `develop`, a ref
		// that does not exist — so a failed SHA lookup must not produce a fake commit.
		install(({ path }) => {
			if (path === "/repos/huggingface/trl") return { json: { default_branch: "development" } };
			if (path.startsWith("/repos/huggingface/trl/git/ref/")) return { status: 500 };
			if (path.startsWith("/repos/huggingface/trl/git/trees/development")) {
				return { json: treeResponse(TRL_TREE) };
			}
			return undefined;
		});

		const result = await findExamples({ repo: "trl", max_results: 1 });

		expect(result.isError).toBe(false);
		expect(result.text).toContain("'ref': 'development'");
		expect(result.text).not.toContain("develop'");
		// And says the listing is not pinned, rather than implying a snapshot.
		expect(result.text).toContain("not pinned");
	});

	it("reads the tree through the branch when the commit cannot be resolved", async () => {
		const recorder = install(({ path }) => {
			if (path === "/repos/huggingface/trl") return { json: { default_branch: "main" } };
			if (path.startsWith("/repos/huggingface/trl/git/ref/")) return { status: 500 };
			if (path.startsWith("/repos/huggingface/trl/git/trees/main")) {
				return { json: treeResponse(TRL_TREE) };
			}
			return undefined;
		});

		const result = await findExamples({ repo: "trl", max_results: 1 });
		expect(result.isError).toBe(false);
		expect(recorder.paths.some((p) => p.includes("/git/trees/main"))).toBe(true);
	});

	it("accepts a bare name and an owner/repo pair alike", async () => {
		install(trlResponder());
		const bare = await findExamples({ repo: "trl" });
		resetGithubCache();
		const full = await findExamples({ repo: "huggingface/trl" });
		expect(full.text).toBe(bare.text);
	});

	it("ignores `org` when `repo` already carries an owner", async () => {
		// The Python original built "huggingface/huggingface/trl" here and 404'd.
		install(trlResponder());
		const result = await findExamples({ repo: "huggingface/trl", org: "huggingface" });
		expect(result.isError).toBe(false);
		expect(mock?.paths[0]).toBe("/repos/huggingface/trl");
	});

	it("says so when the listing was capped, and stays quiet when it was not", async () => {
		install(trlResponder());
		const capped = await findExamples({ repo: "trl", max_results: 2 });
		expect(capped.text).toContain("showing the top 2");

		resetGithubCache();
		const whole = await findExamples({ repo: "trl", max_results: 100 });
		expect(whole.text).not.toContain("showing the top");
	});

	it("marks a partial listing when GitHub truncated the tree", async () => {
		// Silently ranking a partial tree reads as a complete answer; for a repo the
		// size of transformers that is a live concern, not a hypothetical.
		install(trlResponder(treeResponse(TRL_TREE, true)));
		const result = await findExamples({ repo: "trl" });
		expect(result.text).toContain("truncated");
		expect(result.isError).toBe(false);
	});

	it("explains an empty keyword result instead of returning nothing", async () => {
		install(trlResponder());
		const result = await findExamples({ repo: "trl", keyword: "zzzznotathing" });

		expect(result.text).toContain("zzzznotathing");
		expect(result.text).toContain("min_score");
		// Names what it does have, so the next call is informed rather than a guess.
		expect(result.text).toContain("examples/scripts");
	});

	it("explains a repo with no example-shaped files at all", async () => {
		install(({ path }) => {
			if (path === "/repos/huggingface/trl") return { json: { default_branch: "main" } };
			if (path === "/repos/huggingface/trl/git/ref/heads/main") {
				return { json: { object: { sha: COMMIT } } };
			}
			if (path.startsWith(`/repos/huggingface/trl/git/trees/${COMMIT}`)) {
				return { json: treeResponse(["README.md", "setup.py", "trl/trainer/utils.py"]) };
			}
			return undefined;
		});
		const result = await findExamples({ repo: "trl" });
		expect(result.text).toContain("may not ship runnable examples");
		expect(result.isError).toBe(false);
	});

	it("answers a misremembered repo name with the org's closest matches", async () => {
		install(({ path }) => {
			if (path.startsWith("/search/repositories")) {
				return {
					json: {
						items: [
							{
								full_name: "huggingface/trl",
								description: "Train transformer language models with reinforcement learning.",
								stargazers_count: 12345,
								html_url: "https://github.com/huggingface/trl",
							},
						],
					},
				};
			}
			return undefined; // /repos/huggingface/tlr 404s
		});

		const result = await findExamples({ repo: "tlr" });
		expect(result.text).toContain("Did you mean");
		expect(result.text).toContain("huggingface/trl");
		// A dead end turned into a next move is not a failed call.
		expect(result.isError).toBe(false);
	});

	it("fuzzy-matches the org's repos when GitHub's search spells nothing back", async () => {
		// GitHub matches name terms without spell-correcting: `transformer` finds
		// `transformers`, but a transposition like `tlr` finds literally nothing —
		// and a transposition is exactly what a model recalling a name gets wrong.
		install(({ path }) => {
			if (!path.startsWith("/search/repositories")) return undefined;
			if (path.includes("tlr")) return { json: { items: [] } };
			return {
				json: {
					items: [
						{ full_name: "huggingface/transformers", stargazers_count: 164400 },
						{ full_name: "huggingface/trl", stargazers_count: 19145 },
						{ full_name: "huggingface/diffusers", stargazers_count: 34369 },
					],
				},
			};
		});

		const result = await findExamples({ repo: "tlr" });
		expect(result.text).toContain("Did you mean");
		// `tlr` scores identically against `trl` and `transformers`; the one that is
		// the same length as what was asked for is the one that was meant.
		expect(result.text.indexOf("huggingface/trl")).toBeLessThan(
			result.text.indexOf("huggingface/transformers")
		);
		expect(result.text).not.toContain("diffusers");
	});

	it("reports a plain not-found when nothing in the org is close either", async () => {
		install(({ path }) =>
			path.startsWith("/search/repositories") ? { json: { items: [] } } : undefined
		);
		const result = await findExamples({ repo: "definitelynotarepo" });
		expect(result.isError).toBe(true);
		expect(result.text).toContain("No repository named");
	});

	it("reports a missing token rather than falling back to unauthenticated reads", async () => {
		const { config } = await import("$lib/server/config");
		const previous = config.GITHUB_TOKEN;
		(config as { GITHUB_TOKEN: string }).GITHUB_TOKEN = "";
		try {
			const result = await findExamples({ repo: "trl" });
			expect(result.isError).toBe(true);
			expect(result.text).toContain("GITHUB_TOKEN");
		} finally {
			(config as { GITHUB_TOKEN: string }).GITHUB_TOKEN = previous;
		}
	});

	it("rejects a repo argument it cannot read, with the accepted forms", async () => {
		const result = await findExamples({ repo: "huggingface/huggingface/trl" });
		expect(result.isError).toBe(true);
		expect(result.text).toContain("owner/repo");
	});

	it("clamps max_results to a ceiling so one call cannot swamp the context", async () => {
		install(trlResponder());
		const result = await findExamples({ repo: "trl", max_results: 100000 });
		expect(result.isError).toBe(false);
	});
});
