import { error, json, type RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { requireHeadlessCaller } from "$lib/server/mlHeadless/auth";
import { HeadlessRunError, findRun, readRun, startRun } from "$lib/server/mlHeadless/runs";

const body = z.object({
	prompt: z.string().trim().min(1).max(100_000),
	budgetUsd: z.number().finite().min(0),
	title: z.string().max(200).optional(),
});

/** Start an unattended ML Intern run. See docs/source/ml-intern/headless-api.md. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const { settings, identity } = await requireHeadlessCaller(locals);
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, "Expected { prompt: string, budgetUsd: number, title?: string }");

	let id;
	try {
		id = await startRun(identity, settings, parsed.data);
	} catch (err) {
		if (err instanceof HeadlessRunError) error(400, err.message);
		throw err;
	}
	const conv = await findRun(identity, id.toHexString());
	if (!conv) error(500, "The run was created but could not be read back.");
	return json(await readRun(conv), { status: 201 });
};
