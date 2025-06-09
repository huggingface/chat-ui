import { useAPIClient, handleResponse } from "$lib/APIClient";
import { UrlDependency } from "$lib/types/UrlDependency";
import { redirect } from "@sveltejs/kit";

export const load = async ({ params, depends, fetch }) => {
	depends(UrlDependency.Conversation);

	const client = useAPIClient({ fetch });

	try {
		return await client.conversations({ id: params.id }).get().then(handleResponse);
	} catch {
		redirect(302, "/");
	}
};
