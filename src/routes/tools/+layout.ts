// check if user is earlyAccess else redirect to base

import { base } from "$app/paths";
import { redirect } from "@sveltejs/kit";

// XXX: feature_flag_tools
export async function load({ parent }) {
	const { user } = await parent();

	if (user?.isEarlyAccess) {
		return {};
	}

	redirect(302, `${base}/`);
}
