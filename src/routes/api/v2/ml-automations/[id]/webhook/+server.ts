import { error, json, type RequestHandler } from "@sveltejs/kit";
import { receiveDelivery } from "$lib/server/mlAutomations/receive";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";

export const POST: RequestHandler = async ({ params, request }) => {
	if (!ML_ASSISTANT_MODE) error(404, "Not found");
	const result = await receiveDelivery({
		automationId: params.id ?? "",
		secret: request.headers.get("x-webhook-secret"),
		deliveryId: request.headers.get("webhook-id"),
		body: await request.json().catch(() => undefined),
	});
	return json({ message: result.message }, { status: result.status });
};
