import { env } from "$env/dynamic/private";
import { Client } from "@gradio/client";
import type { BackendTool } from ".";

export type GradioImage = {
	path: string;
	url: string;
	orig_name: string;
	is_stream: boolean;
	meta: Record<string, unknown>;
};

type GradioResponse = {
	data: unknown[];
};

export async function callSpace<TInput extends unknown[], TOutput extends unknown[]>(
	name: string,
	func: string,
	parameters: TInput
): Promise<TOutput> {
	const client = await Client.connect(name, {
		hf_token: (env.HF_TOKEN ?? env.HF_ACCESS_TOKEN) as unknown as `hf_${string}`,
	});
	return await client
		.predict(func, parameters)
		.then((res) => (res as unknown as GradioResponse).data as TOutput);
}

/**
 * Checks if a tool's name equals a value. Replaces all hyphens with underscores before comparison
 * since some models return underscores even when hyphens are used in the request.
 **/
export function toolHasName(name: string, tool: BackendTool): boolean {
	return tool.name.replaceAll("-", "_") === name.replaceAll("-", "_");
}
