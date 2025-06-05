import { useAPIClient, throwOnError } from "$lib/APIClient";

export const load = async ({ parent, fetch }) => {
	const client = useAPIClient({ fetch });

	const reports = await client.user.reports.get().then(throwOnError);

	return {
		assistants: (await parent().then((data) => data.assistants)).map((el) => ({
			...el,
			reported: reports.some((r) => r.contentId === el._id && r.object === "assistant"),
		})),
	};
};
