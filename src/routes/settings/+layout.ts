import { useAPIClient, handleResponse } from "$lib/APIClient";

export const load = async ({ parent, fetch }) => {
	const client = useAPIClient({ fetch });

	const reports = await client.user.reports.get().then(handleResponse);

	return {
		assistants: (await parent().then((data) => data.assistants)).map((el) => ({
			...el,
			reported: reports.some(
				(r) => r.contentId.toString() === el._id.toString() && r.object === "assistant"
			),
		})),
	};
};
