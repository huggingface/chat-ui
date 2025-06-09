import { handleResponse, useAPIClient } from "$lib/APIClient";

export const load = async ({ url, fetch }) => {
	const client = useAPIClient({ fetch });

	return client.tools.search
		.get({ query: Object.fromEntries(url.searchParams.entries()) })
		.then(handleResponse);
};
