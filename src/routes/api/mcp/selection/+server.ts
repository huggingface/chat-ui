import { error } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import {
	mcpSelectionSchema,
	mcpSyncStatus,
	saveMcpSelection,
} from "$lib/server/mcp/savedSelection";

const bodySchema = mcpSelectionSchema.extend({ userId: z.string() });

export const PUT: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user || locals.user.slackBotTeamId) error(401, "Sign in to sync MCP servers.");
	if (request.headers.get("origin") !== url.origin) error(403, "Invalid origin.");
	const text = await request.text();
	if (text.length > 256_000) error(413, "MCP selection is too large.");
	let input;
	try {
		input = bodySchema.parse(JSON.parse(text));
	} catch {
		error(400, "Invalid MCP selection.");
	}
	// A stale browser tab must not write its selection into a newly signed-in account.
	if (input.userId !== locals.user._id.toHexString())
		error(409, "Account changed. Reload HuggingChat.");
	// Headers stay in the browser unless the user connected Slack and opted in.
	if (!(await mcpSyncStatus(locals.user._id))) return new Response(null, { status: 204 });
	await saveMcpSelection(locals.user._id, input);
	return new Response(null, { status: 204 });
};
