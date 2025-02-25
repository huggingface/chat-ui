import { redirect, type LoadEvent } from "@sveltejs/kit";

export const load = async ({ params, url }: LoadEvent) => {
	const leafId = url.searchParams.get("leafId");

	redirect(302, "../conversation/" + params.id + `?leafId=${leafId}`);
};
