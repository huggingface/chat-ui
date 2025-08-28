import { useAPIClient, handleResponse } from "$lib/APIClient";

export const load = async ({ params, fetch, url }) => {
	const client = useAPIClient({ fetch, origin: url.origin });

	const data = client
		.tools({
			id: params.toolId,
		})
		.get()
		.then(handleResponse);

	return { tool: await data };
};
