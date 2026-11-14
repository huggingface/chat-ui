import {
	commit,
	createRepo,
	datasetInfo,
	fileExists,
	HubApiError,
	type RepoDesignation,
} from "@huggingface/hub";
import { z } from "zod";
import { afterCreate } from "$lib/server/hubAfterCreate";
import { logger } from "$lib/server/logger";

const REPO_SEGMENT = "[\\w-][\\w.-]*";

export const traceRepoSchema = z
	.string()
	.trim()
	.transform((repo) =>
		repo
			.replace(/^https?:\/\/(www\.)?(huggingface\.co|hf\.co)\//, "")
			.replace(/^datasets\//, "")
			.replace(/\/+$/, "")
	)
	.pipe(
		z
			.string()
			.regex(
				new RegExp(`^(?!.*\\.\\.)${REPO_SEGMENT}/${REPO_SEGMENT}$`),
				'Dataset must be "owner/name"'
			)
	);

export type TracePushResult =
	| { ok: true; url: string; created: boolean; private: boolean }
	| { ok: false; status: number; message: string; code?: "public-dataset" };

/** the card is what puts the dataset in the Hub's trace viewer, the front matter is its switch */
const TRACE_DATASET_CARD = `---
viewer_mode: traces
pretty_name: Chat traces
tags:
- agent-traces
- format:agent-traces
- traces
configs:
- config_name: default
  default: true
  data_files:
  - split: train
    path:
    - '*.jsonl'
---

# Chat traces

Chat sessions pushed from the share menu, one \`.jsonl\` file per conversation in the Hub's
[Session Traces Format](https://huggingface.co/docs/hub/session-traces-format).
`;

const statusOf = (err: unknown) => (err instanceof HubApiError ? err.statusCode : undefined);

async function visibility(name: string, accessToken: string) {
	try {
		const info = await datasetInfo({ name, accessToken });
		return info.private ? "private" : "public";
	} catch (err) {
		if (statusOf(err) === 404) return "missing";
		throw err;
	}
}

export async function pushTraceToDataset(params: {
	repo: string;
	accessToken: string;
	path: string;
	content: string;
	title: string;
	allowPublic: boolean;
}): Promise<TracePushResult> {
	const { repo: name, accessToken, path, content, title, allowPublic } = params;
	const repo: RepoDesignation = { type: "dataset", name };
	const write = (withCard: boolean) =>
		commit({
			repo,
			accessToken,
			title: `Add chat trace: ${title}`.slice(0, 200),
			operations: [
				{
					operation: "addOrUpdate",
					path,
					content: new Blob([content], { type: "application/jsonl" }),
				},
				...(withCard
					? [
							{
								operation: "addOrUpdate" as const,
								path: "README.md",
								content: new Blob([TRACE_DATASET_CARD], { type: "text/markdown" }),
							},
						]
					: []),
			],
		});
	// a card someone wrote is theirs, only a dataset without one gets ours
	const lacksCard = () =>
		fileExists({ repo, path: "README.md", accessToken }).then(
			(exists) => !exists,
			() => false
		);

	let created = false;
	// set while the Hub is refusing to create the dataset, not to write to one
	let createRefused = false;
	try {
		const seen = await visibility(name, accessToken);
		if (seen === "public" && !allowPublic) {
			return {
				ok: false,
				status: 409,
				code: "public-dataset",
				message: `${name} is public, anyone will be able to read this trace.`,
			};
		}
		if (seen === "missing") {
			// the hub 404s a private repo the token cannot see, then 409s creating it
			await createRepo({ repo, accessToken, private: true }).catch((err) => {
				if (statusOf(err) === 409) throw new HubApiError("", 403);
				createRefused = true;
				throw err;
			});
			created = true;
			await afterCreate(() => write(true));
		} else {
			await write(await lacksCard());
		}
		return {
			ok: true,
			url: `https://huggingface.co/datasets/${name}/blob/main/${path}`,
			created,
			private: seen !== "public",
		};
	} catch (err) {
		const status = statusOf(err);
		logger.warn({ err, repo: name, status }, "[trace] push to dataset failed");
		if (status === 401 || status === 403) {
			return {
				ok: false,
				status: 403,
				// a sign-in from before the app asked for repo access cannot create anything, a new name would not help
				message: createRefused
					? `Hugging Face did not let this sign-in create ${name}. Sign out and back in to grant access to your repositories, and check that you can create datasets under ${name.split("/")[0]}.`
					: `Hugging Face did not let this sign-in write to ${name}. The app can only write to datasets it created, so try a new dataset name.`,
			};
		}
		if (status === 409) {
			return { ok: false, status: 409, message: `${name} is busy with another commit, try again.` };
		}
		return { ok: false, status: 502, message: "The push to the Hub failed, try again." };
	}
}
