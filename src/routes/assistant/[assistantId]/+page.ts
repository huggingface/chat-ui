import { useAPIClient, throwOnError } from "$lib/APIClient";
import { jsonSerialize } from "$lib/utils/serialize";

export async function load({ fetch, params }) {
	const client = useAPIClient({ fetch });

	const data = client
		.assistants({ id: params.assistantId })
		.get()
		.then(throwOnError)
		.then(jsonSerialize);

	await client.assistants({ id: params.assistantId }).follow.post();

	return { assistant: await data };
}
