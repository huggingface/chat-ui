import { base } from "$app/paths";
import { redirect } from "@sveltejs/kit";

export async function load({ params, parent, fetch }) {
	const r = await fetch(`${base}/api/v2/models/${params.model}/subscribe`, {
		method: "POST",
	});

	if (!r.ok) {
		redirect(302, base + "/");
	}

	return {
		settings: await parent().then((data) => ({
			...data.settings,
			activeModel: params.model,
		})),
	};
}
