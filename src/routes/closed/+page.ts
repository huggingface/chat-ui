import { base } from "$app/paths";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { redirect } from "@sveltejs/kit";

export const load = async ({ parent, fetch }) => {
	const { publicConfig } = await parent();
	const client = useAPIClient({ fetch });

	if (!publicConfig.isClosed) {
		throw redirect(302, base + "/");
	}

	return {
		nextExport: await client.user["next-export"]
			.get()
			.then(handleResponse)
			.catch((e) => {
				console.error(e);
				return null;
			}),
	};
};
