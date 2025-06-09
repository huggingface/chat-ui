import { useAPIClient, handleResponse } from "$lib/APIClient";

export const load = async ({ url, fetch }) => {
	const client = useAPIClient({ fetch });

	const data = client.assistants.search
		.get({ query: Object.fromEntries(url.searchParams.entries()) })
		.then(handleResponse);

	return data;
};
