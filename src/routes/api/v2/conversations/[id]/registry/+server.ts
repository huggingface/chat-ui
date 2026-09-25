import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { listMlArtefacts, listMlServices } from "$lib/server/mlRegistry/store";
import { listMlAgentRuns } from "$lib/server/mlRegistry/agentRuns";
import { listMlSources } from "$lib/server/mlRegistry/sources";
import { listMlFiles } from "$lib/server/mlFiles/store";
import type {
	MlRegistryAgentRun,
	MlRegistryArtefact,
	MlRegistryPayload,
	MlRegistryService,
} from "$lib/types/MlRegistry";

const TASK_PREVIEW_MAX = 160;

/** every sub-agent puts what to do in the last paragraph of its task, after its handle or context */
function taskPreview(task: string): string {
	const paragraphs = task.split(/\n\s*\n/).filter((paragraph) => paragraph.trim());
	const last = (paragraphs[paragraphs.length - 1] ?? "").replace(/\s+/g, " ").trim();
	return last.length > TASK_PREVIEW_MAX ? `${last.slice(0, TASK_PREVIEW_MAX)}…` : last;
}

export const GET: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	// a share snapshot has no registry of its own, and its reader is not the owner
	if (id.length === 7) error(404, "Conversation not found");

	const conversation = await resolveConversation(id, locals);
	const conversationId = new ObjectId(conversation._id);
	const [services, agentRuns, artefacts, files, sources] = await Promise.all([
		listMlServices(conversationId),
		listMlAgentRuns(conversationId),
		listMlArtefacts(conversationId),
		listMlFiles(conversationId),
		listMlSources(conversationId),
	]);

	// joined here so the client never sees the ledger, only what each row still holds
	const mlBudget = "mlBudget" in conversation ? conversation.mlBudget : undefined;
	const holds = new Map(
		(mlBudget?.reservations ?? []).map((reservation) => [
			reservation.key,
			reservation.ceilingMicroUsd,
		])
	);

	const payload: MlRegistryPayload = {
		services: services.map(({ _id, conversationId: _conversationId, ...service }) => {
			const held = service.reservationKey ? holds.get(service.reservationKey) : undefined;
			const row: MlRegistryService = { ...service, id: _id.toString() };
			return held === undefined ? row : { ...row, heldMicroUsd: held };
		}),
		agentRuns: agentRuns.map(
			({ _id, conversationId: _conversationId, task, ...run }): MlRegistryAgentRun => ({
				...run,
				id: _id.toString(),
				taskPreview: taskPreview(task),
			})
		),
		artefacts: artefacts.map(
			({ _id, conversationId: _conversationId, serviceId, ...artefact }): MlRegistryArtefact => ({
				...artefact,
				id: _id.toString(),
				...(serviceId ? { serviceId: serviceId.toString() } : {}),
			})
		),
		files,
		sources: sources.map(({ _id, conversationId: _conversationId, ...source }) => ({
			...source,
			id: _id.toString(),
		})),
		serverNow: Date.now(),
	};
	return superjsonResponse(payload);
};
