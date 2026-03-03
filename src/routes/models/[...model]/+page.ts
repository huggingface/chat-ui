import { base } from "$app/paths";
import { apiOrigin } from "$lib/utils/apiBase";

export async function load({ params, parent, fetch }) {
	await fetch(`${apiOrigin}${base}/api/v2/models/${params.model}/subscribe`, {
		method: "POST",
	});

	return {
		settings: await parent().then((data) => ({
			...data.settings,
			activeModel: params.model,
		})),
	};
}
