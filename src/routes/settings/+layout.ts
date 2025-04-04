import type { Report } from "$lib/types/Report";
import { base } from "$app/paths";
import type { Serialize } from "$lib/utils/serialize";

export const load = async ({ parent }) => {
	const reports = await fetch(`${base}/api/v2/user/reports`)
		.then((res) => res.json() as Promise<Serialize<Report>[]>)
		.catch(() => []);

	return {
		assistants: (await parent().then((data) => data.assistants)).map((el) => ({
			...el,
			reported: reports.some((r) => r.contentId === el._id && r.object === "assistant"),
		})),
	};
};
