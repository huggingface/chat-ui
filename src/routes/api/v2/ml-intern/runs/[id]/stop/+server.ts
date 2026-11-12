import { error, json, type RequestHandler } from "@sveltejs/kit";
import { requireHeadlessCaller } from "$lib/server/mlHeadless/auth";
import { findRun, readRun, stopRun } from "$lib/server/mlHeadless/runs";

/** Stop the agent, including a parked wait or question. Launched Jobs keep running. */
export const POST: RequestHandler = async ({ locals, params }) => {
	const { identity } = await requireHeadlessCaller(locals);
	const conv = await findRun(identity, params.id ?? "");
	if (!conv) error(404, "Run not found");
	await stopRun(identity, conv);
	const fresh = await findRun(identity, params.id ?? "");
	return json(await readRun(fresh ?? conv));
};
