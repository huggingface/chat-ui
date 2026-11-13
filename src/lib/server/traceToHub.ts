import { commit, createRepo, HubApiError, type RepoDesignation } from "@huggingface/hub";
import { z } from "zod";
import { afterCreate } from "$lib/server/mlReviews/destination";

export const traceRepoSchema = z
	.string()
	.trim()
	.transform((repo) => repo.replace(/^(https:\/\/huggingface\.co\/)?datasets\//, ""))
	.pipe(z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Dataset must be "owner/name"'));

export const tracePath = (filename: string) => `traces/${filename}`;

export class TracePushError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

const statusOf = (err: unknown) => (err instanceof HubApiError ? err.statusCode : undefined);

export async function pushTraceToDataset(params: {
	repo: string;
	accessToken: string;
	path: string;
	content: string;
	title: string;
}): Promise<{ url: string; created: boolean }> {
	const { repo: name, accessToken, path, content, title } = params;
	const repo: RepoDesignation = { type: "dataset", name };
	const write = () =>
		commit({
			repo,
			accessToken,
			title: `Add ML Intern trace: ${title}`.slice(0, 200),
			operations: [
				{
					operation: "addOrUpdate",
					path,
					content: new Blob([content], { type: "application/json" }),
				},
			],
		});

	let created = false;
	try {
		try {
			await write();
		} catch (err) {
			if (statusOf(err) !== 404) throw err;
			// the hub 404s a commit to a private repo the token cannot see, then 409s creating it
			await createRepo({ repo, accessToken, private: true }).catch((createErr) => {
				throw statusOf(createErr) === 409 ? new HubApiError("", 403) : createErr;
			});
			created = true;
			await afterCreate(write);
		}
	} catch (err) {
		const status = statusOf(err);
		if (status === 401 || status === 403) {
			throw new TracePushError(`Your Hugging Face sign-in cannot write to ${name}.`, 403);
		}
		if (status === 409) {
			throw new TracePushError(`${name} is busy with another commit, try again.`, 409);
		}
		throw new TracePushError(
			err instanceof Error ? err.message : "The Hub rejected the upload.",
			502
		);
	}
	return { url: `https://huggingface.co/datasets/${name}/blob/main/${path}`, created };
}
