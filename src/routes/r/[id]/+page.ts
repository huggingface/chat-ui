import { redirect, type LoadEvent } from "@sveltejs/kit";

export const load = async ({ params, url }: LoadEvent) => {
	const leafId = url.searchParams.get("leafId");

	throw redirect(302, "../conversation/" + params.id + `?leafId=${leafId}`);
};
