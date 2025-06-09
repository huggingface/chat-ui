import { useAPIClient, handleResponse } from "$lib/APIClient";

export async function load({ fetch, params }) {
	const client = useAPIClient({ fetch });

	const data = client.assistants({ id: params.assistantId }).get().then(handleResponse);

	await client.assistants({ id: params.assistantId }).follow.post();

	return { assistant: await data };
}
