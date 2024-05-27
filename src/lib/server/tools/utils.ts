import { env } from "$env/dynamic/private";
import { Client } from "@gradio/client";

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

export { toolHasName } from "$lib/utils/tools";
