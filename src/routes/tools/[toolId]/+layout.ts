import { useAPIClient, handleResponse } from "$lib/APIClient";

export const load = async ({ params, fetch }) => {
	const client = useAPIClient({ fetch });

	const data = client
		.tools({
			id: params.toolId,
		})
		.get()
		.then(handleResponse);

	return { tool: await data };
};
