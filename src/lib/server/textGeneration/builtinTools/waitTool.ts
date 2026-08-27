import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { BuiltinTool } from "./types";

export const WAIT_TOOL_NAME = "wait";

/**
 * Below this a wait is not worth a turn — the model should just call the tool
 * again. Above it, the sweep interval stops being the dominant error.
 */
const MIN_WAIT_SECONDS = 15;
/**
 * A single wait is capped well under the parked-row TTL. Longer waits are
 * expressed as several hops, which also gives the model a chance to notice the
 * thing it is waiting for has failed.
 */
const MAX_WAIT_SECONDS = 30 * 60;

/**
 * Parking is cheap per hop and unbounded in aggregate: park, resume, park again
 * is a loop that costs a turn each time and never returns to the user. This is
 * the ceiling on hops in one conversation — the same role the repetition guard
 * plays for tool calls.
 */
const MAX_WAITS_PER_CONVERSATION = 40;

export const waitBuiltin: BuiltinTool = {
	name: WAIT_TOOL_NAME,
	definition: {
		type: "function" as const,
		function: {
			name: WAIT_TOOL_NAME,
			description:
				"Stop and come back later. Use this while waiting on something that takes real " +
				"time — a training job, a long evaluation — instead of calling its status tool " +
				"again immediately. Your turn ends here and resumes automatically after the delay, " +
				"with everything you have done so far intact. Calling a status tool in a tight " +
				"loop does not make the work finish sooner; it burns the turn.",
			parameters: {
				type: "object",
				properties: {
					seconds: {
						type: "integer",
						minimum: MIN_WAIT_SECONDS,
						maximum: MAX_WAIT_SECONDS,
						description:
							"How long to wait before being woken. Match it to the work: a job that " +
							"takes an hour is several long waits, not sixty short ones.",
					},
					reason: {
						type: "string",
						description:
							"What you are waiting for, in a few words. Shown to the user while you wait.",
					},
				},
				required: ["seconds", "reason"],
			},
		},
	},
	mayPark: true,
	parkRefusalMessage:
		"Only one call can park per round. Wait for one thing at a time, then check the rest when you wake.",
	preprompt:
		`WAITING: When work you started needs time — a training job, a long evaluation — call ${WAIT_TOOL_NAME} ` +
		`rather than calling its status tool again straight away. Polling in a tight loop does not make the work ` +
		`finish sooner, and it spends the turn you will need to act on the result. Ask for a delay that matches ` +
		`the work, and check the status once when you wake.`,

	async execute(args, ctx) {
		const seconds = Math.round(Number(args.seconds));
		const reason = typeof args.reason === "string" ? args.reason.trim() : "";

		if (!Number.isFinite(seconds)) {
			return {
				error: `'seconds' must be a number between ${MIN_WAIT_SECONDS} and ${MAX_WAIT_SECONDS}.`,
			};
		}
		if (!reason) {
			return { error: "'reason' must say what you are waiting for." };
		}
		if (!ctx.conversationId || !ctx.messageId) {
			// Nothing to resume into; better to say so than to park a turn nothing can wake.
			return { error: "Waiting is not available in this context. Continue without it." };
		}

		const clamped = Math.min(Math.max(seconds, MIN_WAIT_SECONDS), MAX_WAIT_SECONDS);

		const hops = await collections.parkedCalls.countDocuments({
			conversationId: ctx.conversationId,
		});
		if (hops >= MAX_WAITS_PER_CONVERSATION) {
			return {
				error:
					`This conversation has already waited ${hops} times, which is the limit. ` +
					"Stop waiting: report what you know and what is still unfinished, and let the user decide.",
			};
		}

		const parkedCallId = randomUUID();
		const now = new Date();
		await collections.parkedCalls.insertOne({
			_id: new ObjectId(),
			parkedCallId,
			conversationId: ctx.conversationId,
			...(ctx.generationId ? { generationId: ctx.generationId } : {}),
			messageId: ctx.messageId,
			toolCallId: ctx.toolCallId,
			toolUuid: ctx.uuid,
			kind: "timer",
			status: "waiting",
			resumeAt: new Date(now.getTime() + clamped * 1000),
			reason,
			...(ctx.userId ? { userId: ctx.userId } : {}),
			...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
			attempts: 0,
			createdAt: now,
			updatedAt: now,
		});

		logger.info(
			{ parkedCallId, conversationId: ctx.conversationId.toString(), seconds: clamped, reason },
			"[wait] turn parked"
		);

		return { awaitingInput: true };
	},
};

/** The tool result the model reads on the round it wakes into. */
export function waitResumeResultText(park: {
	reason: string;
	resumeAt: Date;
	createdAt: Date;
}): string {
	const waited = Math.round((park.resumeAt.getTime() - park.createdAt.getTime()) / 1000);
	return (
		`Waited ${waited}s for: ${park.reason}. You are now resumed. ` +
		"Check the status of what you were waiting for once, then act on what you find — " +
		"if it is still not ready, wait again rather than polling."
	);
}
