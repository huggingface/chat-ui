import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { serializeModelDetail } from "$lib/server/api/utils/serializeModel";
import { resolveModel } from "$lib/server/api/utils/resolveModel";

export const GET: RequestHandler = async ({ params }) => {
	const model = await resolveModel(params.namespace ?? "");
	// Serialize an explicit field list — the raw model object carries
	// server-only endpoint configuration that must never reach the client.
	return superjsonResponse(serializeModelDetail(model));
};
