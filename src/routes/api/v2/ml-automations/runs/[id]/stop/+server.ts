import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { stopAutomationRun } from "$lib/server/mlAutomations/store";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!ML_ASSISTANT_MODE) error(404, "Not found");
	const user = locals.user;
	if (!user) error(401, "Sign in to stop a run.");
	if (!params.id || !ObjectId.isValid(params.id)) error(404, "Unknown run.");
	if (!(await stopAutomationRun({ ...locals, user }, new ObjectId(params.id))))
		error(404, "Unknown run.");
	return new Response(null, { status: 204 });
};
