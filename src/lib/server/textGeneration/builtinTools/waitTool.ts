import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { turnWaiting } from "$lib/server/generation/turnState";
import { logger } from "$lib/server/logger";
import { claimServiceEvents } from "$lib/server/mlRegistry/events";
import type { ServiceEvent } from "$lib/types/MlService";
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
 * plays for tool calls. Sized for the check-early-then-stretch cadence the
 * tool description asks for: frequent short checks are the intended shape, so
 * the cap exists to stop a runaway loop, not to ration checks.
 */
const MAX_WAITS_PER_CONVERSATION = 100;

const WAITING_PREPROMPT =
	`WAITING: When work you started needs time — a training job, a long evaluation — call ${WAIT_TOOL_NAME} ` +
	`rather than calling its status tool again straight away. Polling in a tight loop does not make the work ` +
	`finish sooner, and it spends the turn you will need to act on the result.`;

/** pass serviceEvents only where an ending job wakes the wait, the guidance promises that wake */
export function createWaitTool({ serviceEvents }: { serviceEvents: boolean }): BuiltinTool {
	return {
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
							description: serviceEvents
								? "How long to wait before being woken. The harness watches every job and " +
									"sandbox you launched and wakes you the moment one ends or fails, so size the " +
									"wait for when you next need to act — the time the work is expected to take " +
									"from here — not to catch a crash. You do not need short first waits for that."
								: "How long to wait before being woken. Check early, then stretch: failures " +
									"cluster in a run's first minutes (image pull, dependency install, the " +
									"first training step), so keep the first wait after a submit short — a " +
									"minute or two — and lengthen later waits as the run proves itself. A " +
									"short check on a healthy run costs almost nothing; a long wait over a " +
									"job that died at step one loses the whole gap.",
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
		preprompt: serviceEvents
			? `${WAITING_PREPROMPT} The harness watches every job and sandbox you launched and wakes you the ` +
				`moment one ends or fails, so ask for a delay that matches the time the work has left rather ` +
				`than a short one to catch a crash, and check the status once when you wake.`
			: `${WAITING_PREPROMPT} Ask for a delay that matches the work, and check the status once when you wake.`,

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

			// delivery only reaches a parked turn, an end before this call would sit out the whole wait
			if (serviceEvents) {
				const ended = await claimServiceEvents(ctx.conversationId);
				if (ended.length > 0) return { resultText: waitSkippedResultText(ended) };
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

			// The park is a lifecycle transition: record it on the turn state and
			// send it in-band, so every subscriber learns the absolute deadline from
			// the same channel that carries the rest of the turn.
			const stateUpdate = await turnWaiting(
				{
					conversationId: ctx.conversationId,
					messageId: ctx.messageId,
					producerId: ctx.generationId ?? "",
					...(ctx.userId ? { userId: ctx.userId } : {}),
					...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
				},
				{ until: new Date(now.getTime() + clamped * 1000), reason }
			);
			ctx.elicitationSink?.emit(stateUpdate);

			return { awaitingInput: true };
		},
	};
}

function formatDuration(totalSeconds: number): string {
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	if (minutes < 60) {
		const seconds = totalSeconds % 60;
		return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	return minutes % 60 > 0 ? `${hours}h${minutes % 60}m` : `${hours}h`;
}

/** status and the next step only, never log lines, reading those is left to the model */
export function serviceEventText(event: ServiceEvent): string {
	const after = event.ranSeconds !== undefined ? ` after ${formatDuration(event.ranSeconds)}` : "";
	if (event.kind === "sandbox") {
		const flavor = event.flavor ? ` (${event.flavor})` : "";
		return (
			`Sandbox ${event.name ?? event.handle ?? event.jobId}${flavor} stopped: ${event.to}${after}. ` +
			"Create a new one if you still need it."
		);
	}
	const details = [event.flavor, event.name ? `id ${event.jobId}` : undefined].filter(Boolean);
	const job = `Job ${event.name ?? event.jobId}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
	switch (event.to) {
		case "ERROR":
			return `${job} failed: ERROR${after}. Read its logs with check_job before changing anything.`;
		case "COMPLETED":
			return (
				`${job} completed${after}. Confirm the result and that its outputs were pushed with ` +
				"check_job before reporting it."
			);
		case "CANCELED":
			return (
				`${job} was cancelled${after}. If you did not cancel it, read its logs with check_job ` +
				"to find out why."
			);
		case "DELETED":
			return (
				`${job} is gone${after}: the Hub no longer has it. Check that its outputs were pushed ` +
				"before relying on them."
			);
		default:
			return `${job} ended: ${event.to}${after}. Read its logs with check_job before acting on it.`;
	}
}

const whatChanged = (events: ServiceEvent[]): string =>
	events.length === 1 ? `a ${events[0].kind} you started` : "jobs you started";

export function waitSkippedResultText(events: ServiceEvent[]): string {
	return [
		`Did not wait: ${whatChanged(events)} already changed state.`,
		...events.map(serviceEventText),
		"Act on this first, then call wait again if something else still needs time.",
	].join("\n");
}

/** The tool result the model reads on the round it wakes into. */
export function waitResumeResultText(park: {
	reason: string;
	resumeAt: Date;
	createdAt: Date;
	wokeEarlyAt?: Date;
	plannedResumeAt?: Date;
	serviceEvents?: ServiceEvent[];
	wokeByHarnessAt?: Date;
}): string {
	const waited = Math.round((park.resumeAt.getTime() - park.createdAt.getTime()) / 1000);
	const planned = park.plannedResumeAt
		? Math.round((park.plannedResumeAt.getTime() - park.createdAt.getTime()) / 1000)
		: undefined;
	const events = park.serviceEvents ?? [];
	// Naming the skipped wait is the load-bearing part: told only that it is
	// resumed, the model reads the short gap as "not ready after the wait I
	// asked for" and stretches the NEXT wait — the opposite of what a user
	// asking to check early wants.
	const early = park.wokeEarlyAt
		? `The user asked you to check early, cutting short ${planned ? `a ${planned}s wait` : "the wait"}. ` +
			"The short gap is their doing, not a signal about the work — size any further wait as you " +
			"would have without this check. "
		: park.wokeByHarnessAt && events.length > 0
			? `You were woken early${planned ? `, cutting short a ${planned}s wait,` : ""} because ` +
				`${whatChanged(events)} changed state; the short gap says nothing else about the work. `
			: "";
	if (events.length === 0) {
		return (
			`Waited ${waited}s for: ${park.reason}. ${early}You are now resumed. ` +
			"Check the status of what you were waiting for once, then act on what you find — " +
			"if it is still not ready, wait again rather than polling."
		);
	}
	return [
		`Waited ${waited}s for: ${park.reason}. ${early}`.trimEnd(),
		...events.map(serviceEventText),
		"You are now resumed. Act on these first; check anything else you were waiting for once, " +
			"and if it is still not ready, wait again rather than polling.",
	].join("\n");
}
