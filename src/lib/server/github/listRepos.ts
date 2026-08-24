import { encodeSegments, githubJson, githubToken, MISSING_TOKEN_MESSAGE } from "./client";
import type { GithubToolResult } from "./types";

/**
 * Repository discovery — the coarse end of the chain, feeding
 * `github_find_examples`. It answers "which library is this and is it
 * maintained", not "how does this API work"; the grounding happens two steps
 * later.
 */

export const DEFAULT_LIMIT = 30;
export const MAX_LIMIT = 100;

const SORTS = ["stars", "forks", "updated", "created"] as const;
type Sort = (typeof SORTS)[number];

interface Repo {
	full_name?: string;
	description?: string | null;
	stargazers_count?: number;
	forks_count?: number;
	language?: string | null;
	html_url?: string;
	topics?: string[];
}

const clampLimit = (value: unknown): number => {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
};

function formatRepo(repo: Repo, index: number): string {
	const stars = (repo.stargazers_count ?? 0).toLocaleString("en-US");
	const forks = (repo.forks_count ?? 0).toLocaleString("en-US");
	const language = repo.language ? ` | Language: ${repo.language}` : "";
	const description = (repo.description ?? "").trim();
	const summary = description.length > 100 ? `${description.slice(0, 100)}…` : description;
	const topics = (repo.topics ?? []).slice(0, 5);

	return [
		`${index + 1}. **${repo.full_name}**`,
		`   ⭐ ${stars} stars | 🍴 ${forks} forks${language}`,
		summary ? `   ${summary}` : undefined,
		`   URL: ${repo.html_url ?? `https://github.com/${repo.full_name}`}`,
		topics.length ? `   Topics: ${topics.join(", ")}` : undefined,
		`   Use in tools: {'repo': '${repo.full_name}'}`,
	]
		.filter(Boolean)
		.join("\n");
}

export async function listRepos(
	args: Record<string, unknown>,
	options: { signal?: AbortSignal } = {}
): Promise<GithubToolResult> {
	if (!githubToken()) return { text: MISSING_TOKEN_MESSAGE, isError: true };

	const rawOwner = typeof args.owner === "string" ? args.owner.trim() : "";
	// Tolerate an "owner/repo" paste, since every other tool here accepts one.
	const owner = rawOwner
		.replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
		.split("/")
		.filter(Boolean)[0];
	if (!owner) {
		return { text: "`owner` is required, e.g. 'huggingface'.", isError: true };
	}

	const ownerType = args.owner_type === "user" ? "user" : "org";
	const sort: Sort = SORTS.includes(args.sort as Sort) ? (args.sort as Sort) : "stars";
	const order = args.order === "asc" ? "asc" : "desc";
	const limit = clampLimit(args.limit);
	const signal = options.signal;

	let repos: Repo[];
	if (sort === "stars" || sort === "forks") {
		// The list endpoints cannot sort by stars or forks. The Python original
		// worked around that by sorting in memory — but it only ever fetched the
		// first page, so "the 10 most-starred repos" was really "the 10 most-starred
		// of the 100 most-recently-created". Search ranks server-side over the whole
		// org, which is the answer the argument actually promises.
		const qualifier = ownerType === "user" ? "user" : "org";
		const query = encodeURIComponent(`${qualifier}:${owner}`);
		const search = await githubJson<{ items?: Repo[] }>(
			`/search/repositories?q=${query}&sort=${sort}&order=${order}&per_page=${limit}`,
			{ signal }
		);
		if (!search.ok) return { text: search.message, isError: true };
		repos = search.data.items ?? [];
	} else {
		const root = ownerType === "user" ? "users" : "orgs";
		const list = await githubJson<Repo[]>(
			`/${root}/${encodeSegments(owner)}/repos?sort=${sort}&direction=${order}&per_page=${limit}`,
			{ signal }
		);
		if (!list.ok) {
			if (list.status === 404) {
				return {
					text: `No ${ownerType === "user" ? "user" : "organization"} named '${owner}' on GitHub. Check the name, or try owner_type '${ownerType === "user" ? "org" : "user"}'.`,
					isError: true,
				};
			}
			return { text: list.message, isError: true };
		}
		repos = Array.isArray(list.data) ? list.data : [];
	}

	if (!repos.length) {
		return {
			text: `No repositories found for '${owner}' (owner_type: ${ownerType}). Check the name, or try the other owner_type.`,
			isError: false,
		};
	}

	const shown = repos.slice(0, limit);
	const header = `**Found ${shown.length} repositor${shown.length === 1 ? "y" : "ies"} for ${owner}, by ${sort} (${order}):**`;
	return {
		text: `${header}\n\n${shown.map(formatRepo).join("\n\n")}`,
		isError: false,
	};
}
