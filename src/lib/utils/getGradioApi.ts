import { base } from "$app/paths";
import type { ApiInfo, JsApiData } from "@gradio/client/dist/types";

export async function getGradioApi(space: string) {
	const api: ApiInfo<JsApiData> = await fetch(`${base}/api/spaces-config?space=${space}`).then(
		(res) => res.json()
	);
	return api;
}
