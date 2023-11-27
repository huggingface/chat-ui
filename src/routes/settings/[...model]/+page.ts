import { error } from "@sveltejs/kit";

export async function load({ parent, params }) {
	const data = await parent();

	if (!data.models.map(({ id }) => id).includes(params.model)) {
		throw error(404, "Model Not found");
	}

	return data;
}
