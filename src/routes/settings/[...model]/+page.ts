import { base } from "$app/paths";
import { redirect } from "@sveltejs/kit";

export async function load({ parent, params }) {
	const data = await parent();

	if (!data.models.map(({ id }) => id).includes(params.model)) {
		throw redirect(302, `${base}/settings`);
	}

	return data;
}
