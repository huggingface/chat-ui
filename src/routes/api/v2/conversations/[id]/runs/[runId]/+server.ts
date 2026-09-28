import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { readMlAgentRun } from "$lib/server/mlRegistry/agentRuns";
import type { MlAgentRun } from "$lib/types/MlAgentRun";
import type { MlAgentRunDetail } from "$lib/types/MlRegistry";

export const GET: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	// a share snapshot has no runs of its own, and its reader is not the owner
	if (id.length === 7) error(404, "Conversation not found");

	const conversation = await resolveConversation(id, locals);
	const runId = params.runId ?? "";
	if (!ObjectId.isValid(runId) || runId.length !== 24) error(404, "Run not found");

	const run = await readMlAgentRun(new ObjectId(conversation._id), new ObjectId(runId));
	if (!run) error(404, "Run not found");
	return superjsonResponse(toDetail(run));
};

const toDetail = ({
	_id,
	conversationId: _conversationId,
	...run
}: MlAgentRun): MlAgentRunDetail => ({
	...run,
	id: _id.toString(),
});
