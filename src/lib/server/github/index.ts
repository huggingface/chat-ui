import { githubToken } from "./client";
import {
	DEFAULT_MAX_RESULTS,
	DEFAULT_MIN_SCORE,
	findExamples,
	MAX_MAX_RESULTS,
} from "./findExamples";
import { DEFAULT_LIMIT, listRepos, MAX_LIMIT } from "./listRepos";
import { DEFAULT_WINDOW_LINES, readFile } from "./readFile";
import { DEFAULT_OWNER } from "./repoRef";
import type { GithubToolResult } from "./types";

/**
 * The GitHub code-grounding tools, offered to ML Assistant conversations.
 *
 * They exist because the agent's knowledge of the Hugging Face library surface —
 * TRL, Transformers, PEFT, Accelerate — is stale by construction: those APIs
 * churn faster than any training cutoff. Ungrounded, a model writes code that
 * *looks* right and fails at import time on a renamed trainer class or a config
 * kwarg that moved between releases. These tools replace recall with retrieval:
 * find a currently-working example in the upstream repo, read it, implement from
 * what is actually there.
 *
 * Three tools, coarse to fine:
 *
 *     github_list_repos      → which library exists and is maintained
 *       └─ github_find_examples  → which file demonstrates the thing
 *            └─ github_read_file → the source, verbatim
 *
 * The chain is advisory. Nothing enforces it programmatically, because the
 * failure mode of a hard precondition is a deadlocked agent when the example
 * genuinely does not exist. What holds it together is the prose below and the
 * matching section of the ML Assistant preprompt — which makes these
 * descriptions behaviour, not documentation. Edit them as carefully as code.
 */

export const GITHUB_LIST_REPOS = "github_list_repos";
export const GITHUB_FIND_EXAMPLES = "github_find_examples";
export const GITHUB_READ_FILE = "github_read_file";

const HANDLERS: Record<
	string,
	(args: Record<string, unknown>, options: { signal?: AbortSignal }) => Promise<GithubToolResult>
> = {
	[GITHUB_LIST_REPOS]: listRepos,
	[GITHUB_FIND_EXAMPLES]: findExamples,
	[GITHUB_READ_FILE]: readFile,
};

/**
 * Stateless, side-effect-free, idempotent reads. No session, no user identity,
 * nothing to approve — which is what makes them safe to run unattended.
 */
export async function runGithubTool(
	name: string,
	args: Record<string, unknown>,
	options: { signal?: AbortSignal } = {}
): Promise<GithubToolResult> {
	const handler = HANDLERS[name];
	if (!handler) return { text: `Unknown GitHub tool: ${name}`, isError: true };
	try {
		return await handler(args, options);
	} catch (err) {
		// A thrown error would reach the model as a bare stack trace, if at all.
		const message = err instanceof Error ? err.message : String(err);
		return { text: `${name} failed: ${message}`, isError: true };
	}
}

const findExamplesTool = {
	type: "function" as const,
	function: {
		name: GITHUB_FIND_EXAMPLES,
		description:
			"Find runnable example scripts in a GitHub repository. Call this BEFORE writing any " +
			"ML training, fine-tuning, or inference code. Your knowledge of these library APIs is " +
			"out of date — trainer classes get renamed, config arguments move between releases — " +
			"so code written from memory looks correct and fails at import time. A current example " +
			"in the upstream repo shows what actually works today. " +
			"The sequence is: github_find_examples → github_read_file → implement. " +
			"Examples: {repo: 'trl', keyword: 'sft'} finds examples/scripts/sft.py; " +
			"{repo: 'trl', keyword: 'grpo'} finds the GRPO trainer script; " +
			"{repo: 'peft', keyword: 'lora'} finds the LoRA fine-tuning examples. " +
			"When NOT to use: you already have the file path (read it), or the task is a data " +
			"query, a status check, or does not produce code.",
		parameters: {
			type: "object",
			properties: {
				repo: {
					type: "string",
					description: `The repository, either as 'trl' or as 'huggingface/trl'. A bare name is looked up under 'org' (default '${DEFAULT_OWNER}').`,
				},
				keyword: {
					type: "string",
					description:
						"What the example should demonstrate, e.g. 'sft', 'grpo', 'lora', 'supervised fine tuning'. Omit to list every example file, best-ranked first.",
				},
				org: {
					type: "string",
					description: `Owner of the repository when 'repo' is a bare name. Default '${DEFAULT_OWNER}'. Ignored when 'repo' already contains an owner.`,
				},
				max_results: {
					type: "integer",
					description: `How many files to return. Default ${DEFAULT_MAX_RESULTS}, maximum ${MAX_MAX_RESULTS}.`,
				},
				min_score: {
					type: "integer",
					description: `Minimum keyword match score, 0-100. Default ${DEFAULT_MIN_SCORE}. Lower it when a keyword returns nothing.`,
				},
			},
			required: ["repo"],
		},
	},
};

const readFileTool = {
	type: "function" as const,
	function: {
		name: GITHUB_READ_FILE,
		description:
			"Read a file from a GitHub repository, verbatim. Use it AFTER github_find_examples to " +
			"study a working implementation: the real imports, the real trainer and config " +
			"arguments, the real dataset handling. Base your code on what you read here rather " +
			"than on what you remember the API looking like. " +
			`Returns up to ${DEFAULT_WINDOW_LINES} lines by default and always reports the total, ` +
			"so read the rest with line_start and line_end when the file is longer. " +
			"Notebooks are converted to Markdown with their outputs stripped, so line numbers " +
			"index that conversion. " +
			"When NOT to use: you do not know the path — call github_find_examples first.",
		parameters: {
			type: "object",
			properties: {
				repo: {
					type: "string",
					description: `The repository as 'huggingface/trl'. A bare name is looked up under '${DEFAULT_OWNER}'.`,
				},
				path: {
					type: "string",
					description: "Path to the file within the repository, e.g. 'examples/scripts/sft.py'.",
				},
				ref: {
					type: "string",
					description:
						"Branch, tag, or commit SHA. Defaults to the repository's default branch. Pass the commit that github_find_examples reported to read the same snapshot it listed.",
				},
				line_start: { type: "integer", description: "First line to return, 1-indexed inclusive." },
				line_end: { type: "integer", description: "Last line to return, 1-indexed inclusive." },
			},
			required: ["repo", "path"],
		},
	},
};

const listReposTool = {
	type: "function" as const,
	function: {
		name: GITHUB_LIST_REPOS,
		description:
			"List a GitHub user's or organization's repositories, ranked. This is the discovery " +
			"step of the grounding chain — github_list_repos → github_find_examples → " +
			"github_read_file → implement — for when you are not sure which library covers a task " +
			"or whether it is still maintained. " +
			"When NOT to use: you already know the repository. Go straight to " +
			"github_find_examples.",
		parameters: {
			type: "object",
			properties: {
				owner: { type: "string", description: "User or organization, e.g. 'huggingface'." },
				owner_type: {
					type: "string",
					enum: ["org", "user"],
					description: "Whether 'owner' is an organization or a user. Default 'org'.",
				},
				sort: {
					type: "string",
					enum: ["stars", "forks", "updated", "created"],
					description: "Ranking. Default 'stars'.",
				},
				order: { type: "string", enum: ["desc", "asc"], description: "Default 'desc'." },
				limit: {
					type: "integer",
					description: `How many repositories to return. Default ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT}.`,
				},
			},
			required: ["owner"],
		},
	},
};

/**
 * Empty without a `GITHUB_TOKEN`: an unauthenticated GitHub read gets 60 requests
 * an hour, which will not carry a conversation, and a tool that is advertised but
 * always fails costs the model a turn to discover that.
 */
export function githubTools() {
	if (!githubToken()) return [];
	// Coarse to fine, matching the order the descriptions tell the model to use them in.
	return [listReposTool, findExamplesTool, readFileTool];
}

export type { GithubToolResult };
