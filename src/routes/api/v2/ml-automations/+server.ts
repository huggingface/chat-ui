import { error, type RequestHandler } from "@sveltejs/kit";
import { ZodError } from "zod";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { createAutomation, listAutomations } from "$lib/server/mlAutomations/store";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";

export const GET: RequestHandler = async ({ locals }) => {
	if (!ML_ASSISTANT_MODE) error(404, "Not found");
	if (!locals.user) error(401, "Sign in to see your automations.");
	return superjsonResponse(await listAutomations(locals.user._id));
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!ML_ASSISTANT_MODE) error(404, "Not found");
	if (!locals.user) error(401, "Sign in to add an automation.");
	const body = await request.json().catch(() => error(400, "Expected a JSON body."));
	try {
		return superjsonResponse(await createAutomation(locals, body), { status: 201 });
	} catch (err) {
		if (err instanceof ZodError) error(400, err.issues[0]?.message ?? "Invalid automation.");
		throw err;
	}
};
