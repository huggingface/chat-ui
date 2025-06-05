import { useAPIClient, throwOnError } from "$lib/APIClient";
import { jsonSerialize } from "$lib/utils/serialize";

export const load = async ({ params, fetch }) => {
	const client = useAPIClient({ fetch });

	const data = client
		.tools({
			id: params.toolId,
		})
		.get()
		.then(throwOnError)
		.then(jsonSerialize);

	return { tool: await data };
};
