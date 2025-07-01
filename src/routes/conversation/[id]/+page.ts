import { base } from "$app/paths";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { UrlDependency } from "$lib/types/UrlDependency";
import { redirect } from "@sveltejs/kit";

export const load = async ({ params, depends, fetch, parent }) => {
	const { publicConfig } = await parent();
	depends(UrlDependency.Conversation);

	const client = useAPIClient({ fetch });

	try {
		const data = await client.conversations({ id: params.id }).get().then(handleResponse);

		if (publicConfig.isClosed && !data.shared) {
			redirect(302, base + "/");
		}

		return data;
	} catch (error) {
		redirect(302, base + "/");
	}
};
