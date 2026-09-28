import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { Conversation } from "$lib/types/Conversation";
import type { PlanState, PlanStep } from "$lib/types/Plan";
import { MessageUpdateType, type MessagePlanUpdate } from "$lib/types/MessageUpdate";
import type { BuiltinTool } from "./types";

export const PLAN_TOOL_NAME = "update_plan";

const MAX_STEPS = 20;
const MAX_STEP_CHARS = 200;
const MAX_STEP_LABEL_CHARS = 24;
const MAX_GOAL_CHARS = 1500;
const MAX_EXPLANATION_CHARS = 200;

/**
 * Hard cap on the rendered plan. The preprompt and tool schemas already share a
 * flat, unmeasured reserve (PROMPT_OVERHEAD_TOKENS in prepareFiles.ts) with the
 * MCP tool schemas, so an unbounded plan would silently push requests past the
 * model's window.
 */
const PLAN_BLOCK_MAX_CHARS = 2000;

export const planToolDefinition = {
	type: "function" as const,
	function: {
		name: PLAN_TOOL_NAME,
		description:
			"Create or update the task plan for complex, multi-step work, and keep it current " +
			"as you go: rewrite the whole plan each call, mark steps completed the moment they " +
			"finish, and revise pending steps when reality diverges. " +
			"Skip it entirely for simple or single-step requests.",
		parameters: {
			type: "object",
			properties: {
				goal: {
					type: "string",
					description:
						"One-paragraph consolidated statement of what the user currently wants, folding " +
						"in every requirement and correction so far. Rewrite it whenever requirements change.",
				},
				explanation: {
					type: "string",
					description: "One-line note on what changed in this update and why.",
				},
				steps: {
					type: "array",
					minItems: 1,
					maxItems: MAX_STEPS,
					description:
						"The full plan, replacing the previous one entirely. 3-7 short, verifiable " +
						"steps; exactly one in_progress at a time.",
					items: {
						type: "object",
						properties: {
							step: { type: "string", description: "The step, short and imperative." },
							label: {
								type: "string",
								description:
									"One or two words naming the step for the compact progress display, " +
									"e.g. 'Baseline eval'.",
							},
							status: {
								type: "string",
								enum: ["pending", "in_progress", "completed", "skipped"],
								description: "Mark abandoned steps skipped instead of deleting them.",
							},
						},
						required: ["step", "status", "label"],
					},
				},
			},
			required: ["goal", "steps"],
		},
	},
};

const planArgsSchema = z.object({
	goal: z.string().trim().min(1, "goal must not be empty"),
	explanation: z.string().trim().optional(),
	steps: z
		.array(
			z.object({
				step: z.string().trim().min(1, "every step needs text"),
				label: z.string().trim().optional(),
				status: z.enum(["pending", "in_progress", "completed", "skipped"]),
			})
		)
		.min(1, "the plan needs at least one step")
		.max(MAX_STEPS, `the plan can have at most ${MAX_STEPS} steps`),
});

export type ParsedPlanArgs =
	| { ok: true; goal: string; steps: PlanStep[]; explanation?: string }
	| { ok: false; error: string };

const truncate = (value: string, max: number): string =>
	value.length > max ? `${value.slice(0, max - 1)}…` : value;

export function parsePlanArgs(args: Record<string, unknown>): ParsedPlanArgs {
	const parsed = planArgsSchema.safeParse(args);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const path = issue?.path.join(".") ?? "";
		return {
			ok: false,
			error: `Invalid update_plan arguments${path ? ` at ${path}` : ""}: ${issue?.message ?? "unknown"}. Retry with a corrected full plan.`,
		};
	}

	// One in_progress is a prompt rule, not a reason to fail the whole update:
	// keep the first and demote the rest so the stored plan stays coherent.
	let sawInProgress = false;
	const steps: PlanStep[] = parsed.data.steps.map((step) => {
		let status = step.status;
		if (status === "in_progress") {
			if (sawInProgress) status = "pending";
			sawInProgress = true;
		}
		const label = step.label ? truncate(step.label, MAX_STEP_LABEL_CHARS) : undefined;
		return {
			step: truncate(step.step, MAX_STEP_CHARS),
			status,
			...(label ? { label } : {}),
		};
	});

	const explanation = parsed.data.explanation
		? truncate(parsed.data.explanation, MAX_EXPLANATION_CHARS)
		: undefined;
	return {
		ok: true,
		goal: truncate(parsed.data.goal, MAX_GOAL_CHARS),
		steps,
		...(explanation ? { explanation } : {}),
	};
}

const STATUS_MARKER: Record<PlanStep["status"], string> = {
	pending: "[ ]",
	in_progress: "[>]",
	completed: "[x]",
	skipped: "[-]",
};

/**
 * The one canonical rendering, used for both the tool result and the per-turn
 * context injection so the model always sees the same shape.
 */
export function renderPlanBlock(plan: Pick<PlanState, "goal" | "steps" | "version">): string {
	const done = plan.steps.filter((s) => s.status === "completed").length;
	const lines = [
		`PLAN (v${plan.version} — ${done}/${plan.steps.length} done)`,
		`Goal: ${truncate(plan.goal, MAX_GOAL_CHARS)}`,
	];
	let length = lines.join("\n").length;
	for (const [index, step] of plan.steps.entries()) {
		const line = `${index + 1}. ${STATUS_MARKER[step.status]} ${truncate(step.step, MAX_STEP_CHARS)}`;
		// Never drop steps silently: report how many the cap cut off.
		if (length + line.length + 1 > PLAN_BLOCK_MAX_CHARS) {
			lines.push(`…and ${plan.steps.length - index} more steps (truncated)`);
			break;
		}
		lines.push(line);
		length += line.length + 1;
	}
	return lines.join("\n");
}

/**
 * Appends the current plan to the final user message, so it sits at the tail of
 * the context (recency) instead of the system prompt (recall dead zone in long
 * conversations, and a prompt-cache invalidation on every change).
 */
export function injectPlanState(
	messages: ChatCompletionMessageParam[],
	plan: PlanState
): ChatCompletionMessageParam[] {
	const block =
		`[CURRENT PLAN — maintained via the ${PLAN_TOOL_NAME} tool; not written by the user. ` +
		`If it is stale or the request has changed, revise it with ${PLAN_TOOL_NAME}.]\n` +
		renderPlanBlock(plan);

	const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
	if (lastUserIndex === -1) {
		logger.debug({}, "[plan] no user message to attach the plan to; skipping injection");
		return messages;
	}

	const target = messages[lastUserIndex];
	if (target.role !== "user") return messages;
	const updated = [...messages];
	if (typeof target.content === "string") {
		updated[lastUserIndex] = { ...target, content: `${target.content}\n\n${block}` };
	} else if (Array.isArray(target.content)) {
		updated[lastUserIndex] = {
			...target,
			content: [...target.content, { type: "text", text: block }],
		};
	}
	return updated;
}

export function createPlanTool(conv: Pick<Conversation, "_id" | "plan">): BuiltinTool {
	return {
		name: PLAN_TOOL_NAME,
		definition: planToolDefinition,
		exemptFromToolRestraint: true,
		preprompt:
			`PLANNING: For complex multi-step work — several distinct stages, multiple tool calls, or requirements that evolve over the conversation — call ${PLAN_TOOL_NAME} before starting and keep it current as you go. ` +
			`Keep 3-7 short, verifiable steps with exactly one in_progress, each with a one-or-two-word label; mark steps completed the moment they finish, and mark abandoned steps skipped instead of deleting them. ` +
			`Rewrite the goal whenever the user's requirements change so it always folds in every correction so far. ` +
			`Never use it for simple or single-step requests, and do not repeat the plan in your reply — the interface already shows it.`,
		async execute(args, ctx) {
			const parsed = parsePlanArgs(args);
			if (!parsed.ok) return { error: parsed.error };

			const plan: PlanState = {
				goal: parsed.goal,
				steps: parsed.steps,
				version: (conv.plan?.version ?? 0) + 1,
				updatedAt: new Date(),
			};

			try {
				await collections.conversations.updateOne(
					{ _id: conv._id },
					{ $set: { plan, updatedAt: plan.updatedAt } }
				);
			} catch (err) {
				logger.error({ err }, "[plan] failed to save the plan");
				return { error: "The plan could not be saved. Try the update_plan call again." };
			}
			conv.plan = plan;

			logger.info(
				{
					conversationId: conv._id.toString(),
					generationId: ctx.generationId,
					version: plan.version,
					stepCount: plan.steps.length,
					completedCount: plan.steps.filter((s) => s.status === "completed").length,
					hasExplanation: Boolean(parsed.explanation),
				},
				"[plan] plan updated"
			);

			const planUpdate: MessagePlanUpdate = {
				type: MessageUpdateType.Plan,
				uuid: ctx.uuid,
				goal: plan.goal,
				steps: plan.steps,
				version: plan.version,
				...(parsed.explanation ? { explanation: parsed.explanation } : {}),
			};
			return { resultText: renderPlanBlock(plan), extraUpdates: [planUpdate] };
		},
	};
}
