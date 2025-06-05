import { getAPIClient, throwOnError } from "$lib/APIClient";

export const load = async ({ url, fetch }) => {
	const client = getAPIClient({ fetch });

	const data = client.assistants.search
		.get({ query: Object.fromEntries(url.searchParams.entries()) })
		.then(throwOnError);

	return data;
};
