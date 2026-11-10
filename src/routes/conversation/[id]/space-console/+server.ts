import type { RequestHandler } from "./$types";
import { error, json } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getUserHubToken } from "$lib/server/apiToken";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { SPACE_ID, lookupSpace } from "$lib/server/hubSpaces";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import {
	CONSOLE_TEXT_MAX,
	recordConsoleEntries,
	recordFrameState,
	type IncomingConsoleEntry,
} from "$lib/server/spaceConsole/store";

const BODY_MAX_BYTES = 512 * 1024;
const ENTRIES_MAX = 100;
/** per conversation and server, the pane posts at most every 500 ms */
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 40;

const recent = new Map<string, number[]>();

function rateLimited(key: string): boolean {
	const now = Date.now();
	const hits = (recent.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
	hits.push(now);
	recent.set(key, hits);
	if (recent.size > 10_000) {
		for (const [k, v] of recent) if (!v.some((at) => now - at < RATE_WINDOW_MS)) recent.delete(k);
	}
	return hits.length > RATE_MAX;
}

async function ownedConversation(params: { id: string }, locals: App.Locals): Promise<ObjectId> {
	if (!locals.user && !locals.sessionId) error(401, "Unauthorized");
	if (!ObjectId.isValid(params.id)) error(404, "Conversation not found");
	const conversation = await collections.conversations.findOne(
		{ _id: new ObjectId(params.id), ...authCondition(locals) },
		{ projection: { _id: 1, mlAssistant: 1 } }
	);
	if (!conversation) error(404, "Conversation not found");
	if (!isMlAssistantConversation(conversation)) error(400, "Only ML Intern conversations");
	return conversation._id;
}

const id = z.string().min(1).max(100);

const bodySchema = z.object({
	space: z.string().regex(SPACE_ID).max(200),
	load: id,
	check: id.optional(),
	state: z.enum(["loading", "connected", "unsupported"]).optional(),
	session_id: id.optional(),
	gradio_version: z.string().max(100).optional(),
	entries: z.array(z.unknown()).max(ENTRIES_MAX).default([]),
});

const entrySchema = z.object({
	session_id: id,
	seq: z.number().int().min(1),
	ts: z.number().finite(),
	level: z.string().min(1).max(32),
	text: z.string().max(CONSOLE_TEXT_MAX * 2),
	stack: z
		.string()
		.max(CONSOLE_TEXT_MAX * 2)
		.optional(),
});

const clip = (text: string) =>
	text.length > CONSOLE_TEXT_MAX ? `${text.slice(0, CONSOLE_TEXT_MAX - 12)}…[truncated]` : text;

export const POST: RequestHandler = async ({ params, locals, request }) => {
	const conversationId = await ownedConversation(params, locals);
	if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX_BYTES) {
		error(413, "Too large");
	}
	const raw = await request.text();
	if (raw.length > BODY_MAX_BYTES) error(413, "Too large");
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(raw);
	} catch {
		error(400, "Invalid body");
	}
	const parsed = bodySchema.safeParse(parsedJson);
	if (!parsed.success) error(400, "Invalid body");
	if (rateLimited(conversationId.toString())) error(429, "Too many console updates");

	const body = parsed.data;
	// bad entries are dropped one by one so one cannot cost the batch
	const entries: IncomingConsoleEntry[] = [];
	for (const candidate of body.entries) {
		const entry = entrySchema.safeParse(candidate);
		if (!entry.success) continue;
		const { session_id, seq, ts, level, text, stack } = entry.data;
		entries.push({
			sessionId: session_id,
			seq,
			ts,
			level,
			text: clip(text),
			...(stack ? { stack: clip(stack) } : {}),
		});
	}

	if (body.state) {
		await recordFrameState({
			conversationId,
			spaceId: body.space,
			loadId: body.load,
			state: body.state,
			checkId: body.check,
			sessionId: body.session_id,
			gradioVersion: body.gradio_version,
		});
	}
	const stored = await recordConsoleEntries(conversationId, body.space, entries);
	return json({ stored, dropped: body.entries.length - entries.length });
};

/** the __sign token a private space frame needs, null when public or when the hub refuses */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	await ownedConversation(params, locals);
	const space = url.searchParams.get("space") ?? "";
	if (!SPACE_ID.test(space)) error(400, "Invalid Space id");
	const token = getUserHubToken(locals);
	const info = await lookupSpace(space, token);
	if (typeof info === "string" || !info.private || !token) {
		return json({ sign: null }, { headers: { "Cache-Control": "no-store" } });
	}
	let sign: string | null = null;
	try {
		const response = await fetch(`https://huggingface.co/api/spaces/${space}/jwt`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(10_000),
		});
		if (response.ok) {
			const body: { token?: unknown } = await response.json();
			if (typeof body.token === "string") sign = body.token;
		}
	} catch {
		// the pane shows the space sign in page instead
	}
	return json({ sign }, { headers: { "Cache-Control": "no-store" } });
};
