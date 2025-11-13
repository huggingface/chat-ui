import type { RequestHandler } from "./$types";
import { error, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { z } from "zod";
import { models } from "$lib/server/models";
import { nanoid } from "nanoid";
import { MetricsServer } from "$lib/server/metrics";

// Dummy model for fallback
const dummyModelId = "dummy-model";

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.text();

	let parsedBody;
	try {
		parsedBody = z
			.object({
				fromShare: z.string().optional(),
				model: z.string(),
				preprompt: z.string().optional(),
			})
			.safeParse(JSON.parse(body));
	} catch (e) {
		error(400, "Invalid request");
	}

	if (!parsedBody.success) {
		// If validation fails, allow dummy model
		const fallbackBody = z
			.object({
				fromShare: z.string().optional(),
				model: z.string().default(dummyModelId),
				preprompt: z.string().optional(),
			})
			.parse(JSON.parse(body));
		parsedBody = { success: true, data: fallbackBody };
	}

	const values = parsedBody.data;

	// Allow dummy model even if not in models list
	let model = models.find((m) => (m.id || m.name) === values.model);
	if (!model && values.model === dummyModelId) {
		// Dummy model is allowed
		model = {
			id: dummyModelId,
			name: dummyModelId,
			displayName: "Dummy Model",
			unlisted: false,
		} as typeof model;
	}

	if (!model) {
		// Fallback to dummy model if model not found
		model = {
			id: dummyModelId,
			name: dummyModelId,
			displayName: "Dummy Model",
			unlisted: false,
		} as typeof model;
	}

	// Shared conversations are no longer supported
	if (values.fromShare) {
		error(404, "Shared conversations are no longer supported");
	}

	if (model.unlisted) {
		error(400, "Can't start a conversation with an unlisted model");
	}

	// Generate conversation ID - client will save to IndexedDB
	const conversationId = nanoid();

	if (MetricsServer.isEnabled()) {
		MetricsServer.getMetrics().model.conversationsTotal.inc({ model: values.model });
	}

	return new Response(
		JSON.stringify({
			conversationId,
		}),
		{ headers: { "Content-Type": "application/json" } }
	);
};

export const GET: RequestHandler = async () => {
	redirect(302, `${base}/`);
};
