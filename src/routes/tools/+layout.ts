import { base } from "$app/paths";
import { redirect } from "@sveltejs/kit";

export async function load({ parent }) {
	const { enableCommunityTools } = await parent();

	if (enableCommunityTools) {
		return {};
	}

	redirect(302, `${base}/`);
}
