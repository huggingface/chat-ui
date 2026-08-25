/**
 * Repo argument parsing, shared by all three tools so that `repo` means one
 * thing everywhere.
 *
 * The Python original split on this: `github_find_examples` took a bare name
 * plus a separate `org`, while the other two took `owner/repo`. Following the
 * advertised chain — paste `github_list_repos`' own `{'repo': 'huggingface/trl'}`
 * hint into `github_find_examples` — built `huggingface/huggingface/trl` and
 * cost a turn every time. Accepting both forms everywhere removes the trap
 * rather than documenting it.
 */

/** The default the ML Assistant preset grounds against. */
export const DEFAULT_OWNER = "huggingface";

export type RepoRef = { owner: string; repo: string };

export type ParsedRepo = { ok: true; ref: RepoRef } | { ok: false; message: string };

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * `repo` may be `"trl"`, `"huggingface/trl"`, or a github.com URL. An explicit
 * `owner/` in `repo` wins over the separate `org`/`owner` argument, because the
 * fuller of the two is the one the model meant.
 */
export function parseRepo(repo: unknown, org?: unknown): ParsedRepo {
	let raw = asString(repo);
	if (!raw) return { ok: false, message: "`repo` is required, e.g. 'trl' or 'huggingface/trl'." };

	raw = raw
		.replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
		.replace(/\.git$/i, "")
		.replace(/^\/+|\/+$/g, "");

	const segments = raw.split("/").filter(Boolean);
	if (segments.length > 2) {
		return {
			ok: false,
			message: `Could not read '${asString(repo)}' as a repository. Use either 'repo' on its own or 'owner/repo'.`,
		};
	}

	const [first, second] = segments;
	if (second) return { ok: true, ref: { owner: first, repo: second } };

	const owner = asString(org) || DEFAULT_OWNER;
	// An owner given as "huggingface/" or a URL is still an owner.
	const ownerName = owner.replace(/^https?:\/\/(?:www\.)?github\.com\//i, "").split("/")[0];
	if (!ownerName) {
		return { ok: false, message: "`org` was given but empty. Omit it or give an owner name." };
	}
	return { ok: true, ref: { owner: ownerName, repo: first } };
}

export const repoSlug = ({ owner, repo }: RepoRef): string => `${owner}/${repo}`;
