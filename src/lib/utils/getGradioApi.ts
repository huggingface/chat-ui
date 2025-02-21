import { base } from "$app/paths";
import type { Client } from "@gradio/client";

export type ApiReturnType = Awaited<ReturnType<typeof Client.prototype.view_api>>;

export async function getGradioApi(space: string) {
	const api: ApiReturnType = await fetch(`${base}/api/spaces-config?space=${space}`).then(
		async (res) => {
			if (!res.ok) {
				throw new Error(await res.text());
			}
			return res.json();
		}
	);
	return api;
}
