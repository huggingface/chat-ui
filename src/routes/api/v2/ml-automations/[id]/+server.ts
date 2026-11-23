import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { deleteAutomation, setAutomationEnabled } from "$lib/server/mlAutomations/store";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";

function target(locals: App.Locals, id: string | undefined) {
	if (!ML_ASSISTANT_MODE) error(404, "Not found");
	if (!locals.user) error(401, "Sign in to change your automations.");
	if (!id || !ObjectId.isValid(id)) error(404, "Unknown automation.");
	return { userId: locals.user._id, id: new ObjectId(id) };
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const { userId, id } = target(locals, params.id);
	const body = z
		.object({ enabled: z.boolean() })
		.strict()
		.safeParse(await request.json().catch(() => undefined));
	if (!body.success) error(400, "Expected { enabled: boolean }.");
	if (!(await setAutomationEnabled(userId, id, body.data.enabled)))
		error(404, "Unknown automation.");
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const { userId, id } = target(locals, params.id);
	if (!(await deleteAutomation(userId, id))) error(404, "Unknown automation.");
	return new Response(null, { status: 204 });
};
