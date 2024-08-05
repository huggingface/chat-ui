import { redirect } from "@sveltejs/kit";

// export const load = async ({ params }: any) => {
// 	throw redirect(302, "../conversation/" + params.id);
// };

export const load = async ({ params, url }: any) => {
	const leafId = url.searchParams.get("leafId");

	throw redirect(302, "../conversation/" + params.id + `?leafId=${leafId}`);
};
