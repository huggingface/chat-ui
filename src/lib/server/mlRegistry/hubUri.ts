import type { MlArtefactKind } from "$lib/types/MlArtefact";

export type HfRepoType = "models" | "datasets" | "spaces" | "buckets";

export interface HfUri {
	type: HfRepoType;
	kind: Exclude<MlArtefactKind, "file" | "dashboard">;
	owner: string;
	name: string;
	revision?: string;
	path?: string;
}

const KIND_BY_TYPE: Record<HfRepoType, HfUri["kind"]> = {
	models: "model",
	datasets: "dataset",
	spaces: "space",
	buckets: "bucket",
};

// hf://<type>/<owner>/<name>[@<revision>][/<path>]
const HF_URI =
	/^hf:\/\/(models|datasets|spaces|buckets)\/([^/\s@]+)\/([^/\s@]+)(?:@([^/\s]+))?(?:\/(.+))?$/;

export function parseHfUri(raw: string): HfUri | undefined {
	const match = HF_URI.exec(raw.trim());
	if (!match) return undefined;
	const [, type, owner, name, revision, path] = match as unknown as [
		string,
		HfRepoType,
		string,
		string,
		string | undefined,
		string | undefined,
	];
	return {
		type,
		kind: KIND_BY_TYPE[type],
		owner,
		name,
		...(revision ? { revision } : {}),
		...(path ? { path } : {}),
	};
}

export const repoUri = (uri: HfUri): string => `hf://${uri.type}/${uri.owner}/${uri.name}`;

/** revision dropped so two writes to one path are one row */
export const fileUri = (uri: HfUri & { path: string }): string => `${repoUri(uri)}/${uri.path}`;

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export function repoUrl(uri: HfUri): string {
	const prefix = uri.type === "models" ? "" : `${uri.type}/`;
	return `https://huggingface.co/${prefix}${uri.owner}/${uri.name}`;
}

/** buckets have no blob view, only resolve */
export function fileUrl(uri: HfUri & { path: string }): string {
	if (uri.type === "buckets") return `${repoUrl(uri)}/resolve/${encodePath(uri.path)}`;
	return `${repoUrl(uri)}/blob/${encodeURIComponent(uri.revision ?? "main")}/${encodePath(uri.path)}`;
}
