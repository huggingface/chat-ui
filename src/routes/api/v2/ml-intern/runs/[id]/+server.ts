import { error, json, type RequestHandler } from "@sveltejs/kit";
import { requireHeadlessCaller } from "$lib/server/mlHeadless/auth";
import { findRun, readRun } from "$lib/server/mlHeadless/runs";

export const GET: RequestHandler = async ({ locals, params }) => {
	const { identity } = await requireHeadlessCaller(locals);
	const conv = await findRun(identity, params.id ?? "");
	if (!conv) error(404, "Run not found");
	return json(await readRun(conv));
};
