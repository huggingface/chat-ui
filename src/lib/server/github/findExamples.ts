import {
	encodePath,
	encodeSegments,
	githubJson,
	METADATA_TIMEOUT_MS,
	MISSING_TOKEN_MESSAGE,
	githubToken,
} from "./client";
import { partialRatioScore, tokenSetRatio, tokenSetRatioAtLeast } from "./fuzzy";
import { parseRepo, repoSlug, type RepoRef } from "./repoRef";
import type { GithubToolResult } from "./types";

/**
 * Finds the runnable example scripts in a repository.
 *
 * This is the tool the whole grounding chain exists for. Everything upstream
 * narrows to a repo and everything downstream reads a file; this is the step
 * that decides *which* file the model learns the current API from, so its
 * ranking is the difference between grounding on `examples/scripts/sft.py` and
 * grounding on a test fixture.
 */

/**
 * Directory names that mark a path as an example rather than library internals,
 * in priority order — the index is the rank.
 *
 * `scripts` leads because in Hugging Face repos the runnable trainers live at
 * `examples/scripts/*.py`, which is the single highest-value target in the
 * corpus. The list is tuned for that corpus; grounding against an unrelated org
 * would want it widened.
 */
export const EXAMPLE_PATTERNS = [
	"scripts",
	"examples",
	"example",
	"notebooks",
	"notebook",
	"tutorials",
	"tutorial",
	"quickstart",
	"walkthroughs",
	"walkthrough",
	"cookbook",
	"cookbooks",
	"recipes",
	"recipe",
	"demos",
	"demo",
	"samples",
	"sample",
	"guides",
	"guide",
	"getting-started",
	"getting_started",
	"playground",
	"howto",
	"how-to",
	"use-cases",
	"usecases",
	"use_cases",
	"sandbox",
	"showcase",
] as const;

/** How close a path must score to a pattern to count as example-shaped at all. */
export const EXAMPLE_THRESHOLD = 60;

/**
 * Defaults live here and only here. In the Python original the function
 * signature said 10/80 and the argument parsing said 50/60, and only the second
 * pair was ever reachable — so the documented defaults were the wrong ones.
 */
export const DEFAULT_MAX_RESULTS = 50;
export const DEFAULT_MIN_SCORE = 60;
/** A ceiling on how much of a tree one call can spend on the model's context. */
export const MAX_MAX_RESULTS = 100;

interface RepoMetadata {
	default_branch?: string;
}
interface TreeEntry {
	path?: string;
	type?: string;
	size?: number;
}
interface TreeResponse {
	tree?: TreeEntry[];
	truncated?: boolean;
}
interface RepoSearchResponse {
	items?: Array<{
		full_name?: string;
		description?: string | null;
		stargazers_count?: number;
		html_url?: string;
	}>;
}

export interface ExampleFile {
	path: string;
	size: number;
	/** Rank position of the best matching path segment, or `Infinity` when none matches exactly. */
	patternPriority: number;
	inExamplesDir: boolean;
	/** Whether the extension is one you can actually run, as opposed to a config or a readme. */
	runnable: boolean;
	depth: number;
	/** Only set when a keyword was given. */
	score?: number;
}

/**
 * Extensions of files you can run. Everything else in an examples directory —
 * the accelerate YAMLs, the README, the requirements.txt — is a companion to a
 * script rather than an example of the API.
 *
 * This is a departure from the Python original, which ordered on directory shape
 * alone. That ordering was written for a layout where the scripts sat under
 * `examples/scripts/`, and against the current TRL tree it answers a bare
 * `{repo: "trl"}` with `examples/README.md` and eight accelerate configs before
 * any Python at all — the ranking is doing its documented job and still failing
 * the tool's actual one.
 */
const RUNNABLE_EXTENSIONS = new Set([
	"py",
	"ipynb",
	"sh",
	"bash",
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"rs",
	"go",
	"java",
	"kt",
	"rb",
	"c",
	"cc",
	"cpp",
	"cu",
	"jl",
	"lua",
	"r",
	"scala",
	"swift",
]);

function isRunnable(path: string): boolean {
	const name = path.split("/").pop() ?? "";
	const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
	return extension !== undefined && RUNNABLE_EXTENSIONS.has(extension);
}

const patternIndex = new Map<string, number>(
	EXAMPLE_PATTERNS.map((pattern, index) => [pattern, index])
);

/**
 * The rank of the *deepest* path segment that is exactly one of the patterns.
 * Deepest rather than first because the inner directory is the more specific
 * claim: `examples/scripts/train.py` is a script, and `scripts` (rank 0) says
 * more about it than `examples` (rank 1) does.
 */
export function bestPatternPriority(segments: string[]): number {
	for (let i = segments.length - 1; i >= 0; i--) {
		const index = patternIndex.get(segments[i].toLowerCase());
		if (index !== undefined) return index;
	}
	return Number.POSITIVE_INFINITY;
}

/** Whether any pattern scores at least the threshold against the whole path. */
function looksLikeExample(path: string): boolean {
	for (const pattern of EXAMPLE_PATTERNS) {
		if (tokenSetRatioAtLeast(pattern, path, EXAMPLE_THRESHOLD) >= EXAMPLE_THRESHOLD) return true;
	}
	return false;
}

/**
 * Keyword relevance: the better of a substring match inside a path segment
 * (`"grpo"` in `"grpo_trainer.py"`) and a whole-token match after the path is
 * split up (`"supervised fine tuning"` against `.../sft/...` style paths).
 * Taking the max is what lets one threshold serve both shapes of query.
 */
export function keywordScore(keyword: string, path: string): number {
	const k = keyword.toLowerCase();
	const p = path.toLowerCase();
	return Math.max(partialRatioScore(k, p), tokenSetRatio(k, p));
}

/**
 * The keyword-free ordering: a top-level `examples/` directory first, then
 * something you can run, then the most specific directory, then the shallowest
 * path, then alphabetical so the result is deterministic.
 */
function compareByShape(a: ExampleFile, b: ExampleFile): number {
	if (a.inExamplesDir !== b.inExamplesDir) return a.inExamplesDir ? -1 : 1;
	if (a.runnable !== b.runnable) return a.runnable ? -1 : 1;
	if (a.patternPriority !== b.patternPriority) return a.patternPriority - b.patternPriority;
	if (a.depth !== b.depth) return a.depth - b.depth;
	return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

export function rankExamples(
	entries: Array<{ path: string; size: number }>,
	keyword: string,
	minScore: number
): ExampleFile[] {
	const examples: ExampleFile[] = [];
	for (const entry of entries) {
		if (!looksLikeExample(entry.path)) continue;
		const segments = entry.path.split("/");
		const first = segments[0]?.toLowerCase();
		examples.push({
			path: entry.path,
			size: entry.size,
			patternPriority: bestPatternPriority(segments),
			inExamplesDir: first === "examples" || first === "example",
			runnable: isRunnable(entry.path),
			depth: segments.length,
		});
	}

	if (!keyword) return examples.sort(compareByShape);

	for (const example of examples) example.score = keywordScore(keyword, example.path);
	// Relevance decides; among equally relevant paths the runnable one wins, and
	// past that the sort is stable, so the rest keeps tree order.
	return examples
		.filter((example) => (example.score ?? 0) >= minScore)
		.sort(
			(a, b) =>
				(b.score ?? 0) - (a.score ?? 0) || (a.runnable === b.runnable ? 0 : a.runnable ? -1 : 1)
		);
}

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

/**
 * The "did you mean" turn. Models guess repo names from memory — `transformer`,
 * `trl-examples` — and a bare 404 ends the chain there, so a 404 is answered
 * with the org's closest matches instead.
 *
 * Reported as a success rather than an error: the call did not fail, it answered
 * a slightly different question, and the model's next move is right there.
 */
async function didYouMean(ref: RepoRef, signal?: AbortSignal): Promise<GithubToolResult> {
	const query = encodeURIComponent(`org:${ref.owner} ${ref.repo}`);
	const search = await githubJson<RepoSearchResponse>(
		`/search/repositories?q=${query}&sort=stars&order=desc&per_page=10`,
		{ signal, cache: false }
	);
	let items = search.ok ? (search.data.items ?? []) : [];

	if (!items.length) {
		// GitHub's repo search matches name terms, it does not spell-correct: `transformer`
		// finds `transformers`, but `tlr` finds nothing at all. Transpositions are exactly
		// what a model recalling a name gets wrong, so fall back to scoring the org's
		// best-known repos against what was asked for.
		const popular = await githubJson<RepoSearchResponse>(
			`/search/repositories?q=${encodeURIComponent(`org:${ref.owner}`)}&sort=stars&order=desc&per_page=100`,
			{ signal }
		);
		if (popular.ok) {
			items = (popular.data.items ?? [])
				.map((item) => {
					const name = (item.full_name ?? "").split("/").pop() ?? "";
					return {
						item,
						score: keywordScore(ref.repo, name),
						// `tlr` scores the same against `trl` and `transformers`; the one that is
						// the same length as what was asked for is the one that was meant.
						lengthGap: Math.abs(name.length - ref.repo.length),
					};
				})
				.filter(({ score }) => score >= DEFAULT_MIN_SCORE)
				.sort((a, b) => b.score - a.score || a.lengthGap - b.lengthGap)
				.slice(0, 5)
				.map(({ item }) => item);
		}
	}

	if (!items.length) {
		return {
			text: `No repository named '${repoSlug(ref)}' exists, and no similarly named repository was found in the '${ref.owner}' organization. Check the owner and name, or use github_list_repos to see what is there.`,
			isError: true,
		};
	}

	const lines = items
		.filter((item) => item.full_name)
		.map((item, index) => {
			const stars = item.stargazers_count?.toLocaleString("en-US") ?? "0";
			const description = (item.description ?? "").trim();
			const summary = description.length > 100 ? `${description.slice(0, 100)}…` : description;
			return [
				`${index + 1}. **${item.full_name}** — ⭐ ${stars}`,
				summary ? `   ${summary}` : undefined,
				`   To search it, use: {'repo': '${item.full_name}'}`,
			]
				.filter(Boolean)
				.join("\n");
		});

	return {
		text: `No repository named '${repoSlug(ref)}' exists. Did you mean one of these?\n\n${lines.join("\n\n")}`,
		isError: false,
	};
}

function formatResults({
	ref,
	keyword,
	matches,
	shown,
	commit,
	branch,
	truncatedTree,
}: {
	ref: RepoRef;
	keyword: string;
	matches: ExampleFile[];
	shown: ExampleFile[];
	/** The resolved commit, or undefined when the tree was read through the branch. */
	commit?: string;
	branch: string;
	truncatedTree: boolean;
}): string {
	const slug = repoSlug(ref);
	// Abbreviating is safe for a SHA and destroys a branch name: truncating a
	// default branch called `development` to `develop` advertises a ref that does
	// not exist and breaks the find-to-read chain outright.
	const readRef = commit ? commit.slice(0, 7) : branch;
	const suffix = keyword ? ` matching '${keyword}'` : "";
	const header =
		matches.length > shown.length
			? `**Found ${matches.length} example files in ${slug}${suffix}** (showing the top ${shown.length}; raise max_results for more)`
			: `**Found ${matches.length} example file${matches.length === 1 ? "" : "s"} in ${slug}${suffix}**`;

	const notes = [
		commit
			? `Tree read at commit ${readRef} (branch ${branch}). Pass that ref to github_read_file to read the same snapshot.`
			: `Tree read from branch ${branch}, which could not be resolved to a commit — these results are not pinned, so the branch may move before you read from it.`,
	];
	if (truncatedTree) {
		notes.push(
			"⚠️ GitHub truncated this repository's file listing, so these results cover only part of the tree. A file you expect may be missing rather than absent."
		);
	}

	const entries = shown.map((file, index) => {
		const readArgs = `{'repo': '${slug}', 'path': '${file.path}', 'ref': '${readRef}'}`;
		return [
			`${index + 1}. **${file.path}**`,
			`   Size: ${file.size.toLocaleString("en-US")} bytes`,
			`   URL: https://github.com/${slug}/blob/${encodeURIComponent(readRef)}/${encodePath(file.path)}`,
			`   To read, use: ${readArgs}`,
		].join("\n");
	});

	return [header, notes.join("\n"), entries.join("\n\n")].join("\n\n");
}

export async function findExamples(
	args: Record<string, unknown>,
	options: { signal?: AbortSignal } = {}
): Promise<GithubToolResult> {
	if (!githubToken()) return { text: MISSING_TOKEN_MESSAGE, isError: true };

	const parsed = parseRepo(args.repo, args.org);
	if (!parsed.ok) return { text: parsed.message, isError: true };
	const ref = parsed.ref;

	const keyword = typeof args.keyword === "string" ? args.keyword.trim() : "";
	const maxResults = clampInt(args.max_results, DEFAULT_MAX_RESULTS, 1, MAX_MAX_RESULTS);
	const minScore = clampInt(args.min_score, DEFAULT_MIN_SCORE, 0, 100);
	const signal = options.signal;
	const base = `/repos/${encodeSegments(ref.owner, ref.repo)}`;

	const metadata = await githubJson<RepoMetadata>(base, {
		signal,
		timeoutMs: METADATA_TIMEOUT_MS,
	});
	if (!metadata.ok) {
		if (metadata.status === 404) return didYouMean(ref, signal);
		return { text: metadata.message, isError: true };
	}
	const branch = metadata.data.default_branch?.trim() || "main";

	// Pin the tree to a commit rather than reading it through a moving branch: the
	// paths and the ref handed to github_read_file then describe the same snapshot,
	// even if the branch advances mid-conversation.
	const head = await githubJson<{ object?: { sha?: string } }>(
		`${base}/git/ref/heads/${encodePath(branch)}`,
		{ signal, timeoutMs: METADATA_TIMEOUT_MS }
	);
	// Undefined rather than the branch name when resolution fails, so nothing
	// downstream can mistake one for the other.
	const commit = head.ok ? head.data.object?.sha : undefined;

	const tree = await githubJson<TreeResponse>(
		`${base}/git/trees/${encodeURIComponent(commit ?? branch)}?recursive=1`,
		{ signal }
	);
	if (!tree.ok) return { text: tree.message, isError: true };

	const blobs = (tree.data.tree ?? [])
		.filter((entry) => entry.type === "blob" && typeof entry.path === "string")
		.map((entry) => ({ path: entry.path as string, size: entry.size ?? 0 }));
	const truncatedTree = tree.data.truncated === true;

	const matches = rankExamples(blobs, keyword, minScore);

	if (!matches.length) {
		const exampleCount = rankExamples(blobs, "", 0).length;
		const partial = truncatedTree
			? " GitHub also truncated this repository's file listing, so the tree read here was incomplete."
			: "";
		if (!exampleCount) {
			return {
				text: `No files in ${repoSlug(ref)} scored at least ${EXAMPLE_THRESHOLD} against the example-directory patterns (${EXAMPLE_PATTERNS.slice(0, 6).join(", ")}, …), out of ${blobs.length} files.${partial} This repository may not ship runnable examples; try github_read_file on its README.md instead.`,
				isError: false,
			};
		}
		const near = rankExamples(blobs, keyword, 0)
			.slice(0, 3)
			.map((file) => `${file.path} (${file.score})`);
		return {
			text: `None of the ${exampleCount} example files in ${repoSlug(ref)} matched '${keyword}' at min_score ${minScore}.${partial} The closest were: ${near.join(", ")}. Lower min_score, try a different keyword, or call again without one to list the examples.`,
			isError: false,
		};
	}

	return {
		text: formatResults({
			ref,
			keyword,
			matches,
			shown: matches.slice(0, maxResults),
			...(commit ? { commit } : {}),
			branch,
			truncatedTree,
		}),
		isError: false,
	};
}
