import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { listMlArtefacts, listMlServices } from "$lib/server/mlRegistry/store";
import { listMlFiles } from "$lib/server/mlFiles/store";
import type {
	MlRegistryArtefact,
	MlRegistryPayload,
	MlRegistryService,
} from "$lib/types/MlRegistry";

export const GET: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	// a share snapshot has no registry of its own, and its reader is not the owner
	if (id.length === 7) error(404, "Conversation not found");

	const conversation = await resolveConversation(id, locals);
	const conversationId = new ObjectId(conversation._id);
	const [services, artefacts, files] = await Promise.all([
		listMlServices(conversationId),
		listMlArtefacts(conversationId),
		listMlFiles(conversationId),
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
		artefacts: artefacts.map(
			({
				_id,
				conversationId: _conversationId,
				serviceId,
				putCommits: _putCommits,
				...artefact
			}): MlRegistryArtefact => ({
				...artefact,
				id: _id.toString(),
				...(serviceId ? { serviceId: serviceId.toString() } : {}),
			})
		),
		files,
		serverNow: Date.now(),
	};
	return superjsonResponse(payload);
};
