import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import { isHfMcpServer } from "$lib/server/mcp/hf";
import type { McpToolMapping, OpenAiTool } from "$lib/server/mcp/tools";
import type {
	GuardedToolCall,
	GuardOutcome,
	GuardVerdict,
	ToolCallGuard,
} from "$lib/server/textGeneration/mcp/toolGuard";
import { MessageUpdateType, type MessageBudgetUpdate } from "$lib/types/MessageUpdate";
import type { MlBudget } from "$lib/types/Conversation";
import { formatMicroUsd, remainingMicroUsd, reservedMicroUsd } from "$lib/utils/mlBudget";
import {
	attachJobToReservation,
	readMlBudget,
	releaseReservation,
	reserveMlBudget,
} from "./budget";
import { settleMlBudget } from "./settle";
import { ceilingMicroUsd, getFlavorPriceMicroUsdPerMinute, parseTimeoutSeconds } from "./pricing";

/**
 * The budget gate for ML Assistant conversations.
 *
 * The model owns sizing — flavor, timeout, whether to run at all. This guard
 * owns the invariant: no submission whose worst case exceeds what remains of
 * the session budget leaves this process. The two meet on one formula, stated
 * to the model in its prompt and computed here the same way:
 * flavor's per-minute price × the timeout, rounded up to the minute.
 *
 * Refusals are ordinary tool errors, so recovery is in-band; the numbers in
 * them come from the same reservation ledger the enforcement uses, so a
 * refusal is always explainable and never disagrees with what the model was
 * told the state was.
 */

/** Jobs launched without an explicit timeout are stopped by the platform at 30 minutes. */
const DEFAULT_JOB_TIMEOUT_SECONDS = 1800;
/** Jobs launched without an explicit flavor run on cpu-basic. */
const DEFAULT_JOB_FLAVOR = "cpu-basic";

interface HoldTicket {
	key: string;
	kind: "job" | "sandbox";
	/** Namespace the submission targeted, when its arguments said so. */
	namespace?: string;
}

/**
 * Carried by a stop — `hf_sandbox terminate`, `hf_jobs cancel` — which reserves
 * nothing itself. It exists so the settle pass can run the moment something the
 * budget is holding for actually stops, rather than waiting for the next turn.
 */
interface ReleaseTicket {
	kind: "release";
}

type Ticket = HoldTicket | ReleaseTicket;

/** The calls that stop something this gate may be holding a reservation for. */
function isStopCall(call: GuardedToolCall): boolean {
	if (call.tool === "hf_jobs") return call.args.operation === "cancel";
	if (call.tool === "hf_sandbox") return call.args.cmd === "terminate";
	return false;
}

interface GatedSubmission {
	kind: "job" | "sandbox";
	flavor: string;
	timeoutRaw: unknown;
	namespace?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/** Value following a `--flag` token in a sandbox-style argument list. */
const tokenAfter = (tokens: string[], flag: string): string | undefined => {
	const at = tokens.indexOf(flag);
	return at >= 0 ? tokens[at + 1] : undefined;
};

/**
 * Operations that verifiably spend nothing: reading and stopping, which must
 * work at any budget. Everything not listed here and not a priced submission
 * fails closed — an operation this gate cannot recognize is one it cannot
 * bound, and "the server will probably reject it" is not enforcement.
 */
const FREE_JOB_OPERATIONS = new Set([
	"ps",
	"logs",
	"inspect",
	"cancel",
	"scheduled ps",
	"scheduled inspect",
	"scheduled delete",
	"scheduled suspend",
	"scheduled resume",
]);
const FREE_SANDBOX_COMMANDS = new Set(["status", "terminate", "ps", "kill"]);

/**
 * What this call is about to spend, or a refusal, or null for calls that spend
 * nothing.
 */
function classify(call: GuardedToolCall): GatedSubmission | { blocked: string } | null {
	if (call.tool === "hf_jobs") {
		const operation = call.args.operation;
		if (operation === "scheduled run" || operation === "scheduled uv") {
			return {
				blocked:
					"Scheduled jobs are not available in this session: a recurring run cannot be held to the session budget. Nothing was scheduled. Run the work directly with operation 'run' or 'uv'.",
			};
		}
		if (typeof operation === "string" && FREE_JOB_OPERATIONS.has(operation)) return null;
		if (operation !== "run" && operation !== "uv") {
			// Not a budget matter — the call names no operation to route, and a
			// call this gate cannot recognize it cannot let through unpriced.
			return {
				blocked: `hf_jobs was called ${
					typeof operation === "string"
						? `with unrecognized operation ${JSON.stringify(operation)}`
						: "without an operation"
				}, so it could not be routed. Nothing was submitted and nothing ran. Pass \`operation\` explicitly on every hf_jobs call — 'run' or 'uv' to submit, 'ps'/'logs'/'inspect'/'cancel' to read or stop. Reads are never budget-gated.`,
			};
		}
		const jobArgs = asRecord(call.args.args) ?? {};
		const flavor = jobArgs.flavor ?? DEFAULT_JOB_FLAVOR;
		if (typeof flavor !== "string") {
			return { blocked: "Budget check: `flavor` must be a string. Nothing was submitted." };
		}
		return {
			kind: "job",
			flavor,
			timeoutRaw: jobArgs.timeout ?? DEFAULT_JOB_TIMEOUT_SECONDS,
			...(typeof jobArgs.namespace === "string" ? { namespace: jobArgs.namespace } : {}),
		};
	}

	if (call.tool === "hf_sandbox") {
		const cmd = call.args.cmd;
		if (typeof cmd === "string" && FREE_SANDBOX_COMMANDS.has(cmd)) return null;
		if (cmd !== "create") {
			return {
				blocked: `hf_sandbox was called ${
					typeof cmd === "string"
						? `with unrecognized command ${JSON.stringify(cmd)}`
						: "without a command"
				}, so it could not be routed. Nothing was created. Use 'create' (with --flavor and --timeout), or 'status'/'ps'/'kill'/'terminate' — reads and stops are never budget-gated.`,
			};
		}
		const rawTokens = call.args.args;
		const tokens = Array.isArray(rawTokens)
			? rawTokens.filter((t): t is string => typeof t === "string")
			: [];
		const flavor = tokenAfter(tokens, "--flavor");
		const timeout = tokenAfter(tokens, "--timeout");
		if (!flavor || !timeout) {
			return {
				blocked:
					"Budget check: sandbox create needs explicit --flavor and --timeout so its worst-case cost can be reserved against the session budget. Nothing was created. Add both flags and retry.",
			};
		}
		const namespace = tokenAfter(tokens, "--namespace");
		return { kind: "sandbox", flavor, timeoutRaw: timeout, ...(namespace ? { namespace } : {}) };
	}

	return null;
}

/** The discriminator each gated tool routes on. */
const DISCRIMINATOR_BY_TOOL: Record<string, string> = { hf_jobs: "operation", hf_sandbox: "cmd" };

/**
 * The Hub's job tool schema marks nothing required, so sloppy models omit the
 * discriminator and their read calls bounce off the gate's fail-closed path.
 * Advertise the schema with it required instead: models are steered toward
 * well-formed calls, and providers that enforce schemas reject the malformed
 * ones before they reach the gate. Returns fresh objects — the originals come
 * from a shared cache and must not be mutated.
 */
export function withRequiredDiscriminators(
	tools: OpenAiTool[],
	mapping: Record<string, McpToolMapping>
): OpenAiTool[] {
	return tools.map((tool) => {
		const entry = mapping[tool.function.name];
		const field = entry ? DISCRIMINATOR_BY_TOOL[entry.tool] : undefined;
		const parameters = tool.function.parameters;
		if (!field || !parameters) return tool;
		const required = Array.isArray(parameters.required) ? (parameters.required as string[]) : [];
		if (required.includes(field)) return tool;
		return {
			...tool,
			function: {
				...tool.function,
				parameters: { ...parameters, required: [...required, field] },
			},
		};
	});
}

/** `huggingface.co/jobs/<namespace>/<id>` in a submission response. */
const JOB_URL_PATTERN = /huggingface\.co\/jobs\/([A-Za-z0-9][\w.-]*)\/([0-9a-f]{24})/;
/** `hfsb2:<namespace>:<job id>` — the sandbox handle format. */
const SANDBOX_HANDLE_PATTERN = /hfsb2:([\w.-]+):([0-9a-f]{24})/;
/** Last resort: any 24-hex id in the response, namespace taken from the args or the user. */
const BARE_JOB_ID_PATTERN = /\b([0-9a-f]{24})\b/;

function extractJobRef(
	text: string,
	fallbackNamespace?: string
): { jobId: string; namespace?: string } | undefined {
	const url = JOB_URL_PATTERN.exec(text);
	if (url) return { namespace: url[1], jobId: url[2] };
	const handle = SANDBOX_HANDLE_PATTERN.exec(text);
	if (handle) return { namespace: handle[1], jobId: handle[2] };
	const bare = BARE_JOB_ID_PATTERN.exec(text);
	if (bare) {
		return { jobId: bare[1], ...(fallbackNamespace ? { namespace: fallbackNamespace } : {}) };
	}
	return undefined;
}

function budgetUpdate(budget: MlBudget): MessageBudgetUpdate {
	return {
		type: MessageUpdateType.Budget,
		totalMicroUsd: budget.totalMicroUsd,
		spentMicroUsd: budget.spentMicroUsd,
		reservedMicroUsd: reservedMicroUsd(budget),
	};
}

export function createMlBudgetGuard({
	conversationId,
	generationId,
	username,
	token,
}: {
	conversationId: ObjectId;
	generationId: string;
	/** Fallback namespace for job ids reported without one. */
	username?: string;
	/** Hub credential the Jobs API is read with, for settling a stop mid-turn. */
	token?: string;
}): ToolCallGuard {
	return {
		// The resume path re-invokes a parked tool without consulting any guard,
		// so a reserved call must fail closed out of it (see toolGuard.ts).
		allowParking: false,

		async before(call: GuardedToolCall): Promise<GuardVerdict> {
			if (!isHfMcpServer(call.serverUrl)) return { allow: true };
			const gated = classify(call);
			// Stops are never gated, but their success is the one moment in a turn
			// when a hold is known to be over. Ticketing them is what lets `after`
			// reconcile without waiting for the next generation — a turn that
			// cycles sandboxes would otherwise hold every ceiling it ever booked.
			if (gated === null) {
				return isStopCall(call)
					? { allow: true, ticket: { kind: "release" } satisfies ReleaseTicket }
					: { allow: true };
			}
			if ("blocked" in gated) return { allow: false, message: gated.blocked };

			const timeoutSeconds = parseTimeoutSeconds(gated.timeoutRaw);
			if (timeoutSeconds === undefined) {
				return {
					allow: false,
					message: `Budget check: timeout ${JSON.stringify(
						gated.timeoutRaw
					)} could not be parsed. Use seconds or a number with an s/m/h/d unit, e.g. 1800, "45m", "2h". Nothing was submitted.`,
				};
			}

			const price = await getFlavorPriceMicroUsdPerMinute(gated.flavor);
			if (price === undefined) {
				return {
					allow: false,
					message: `Budget check: flavor "${gated.flavor}" is not in the Hub's job hardware price list, so its cost cannot be bounded. Nothing was submitted. Pick a flavor from the price list (read hf://docs/hub/jobs-pricing.md).`,
				};
			}

			const ceiling = ceilingMicroUsd(price, timeoutSeconds);
			const minutes = Math.ceil(timeoutSeconds / 60);
			const reserveResult = await reserveMlBudget({
				conversationId,
				reservation: {
					key: `${generationId}:${call.callUuid}`,
					kind: gated.kind,
					flavor: gated.flavor,
					priceMicroUsdPerMinute: price,
					timeoutSeconds,
					ceilingMicroUsd: ceiling,
					createdAt: new Date(),
					...(gated.namespace ? { namespace: gated.namespace } : {}),
				},
			});

			switch (reserveResult.outcome) {
				case "reserved":
				case "already_reserved": {
					const ticket: Ticket = {
						key: `${generationId}:${call.callUuid}`,
						kind: gated.kind,
						...(gated.namespace ? { namespace: gated.namespace } : {}),
					};
					return { allow: true, ticket, update: budgetUpdate(reserveResult.budget) };
				}
				case "insufficient": {
					const remaining = remainingMicroUsd(reserveResult.budget);
					return {
						allow: false,
						message: `Budget check: this ${gated.kind === "job" ? "job" : "sandbox"} would reserve a worst case of ${formatMicroUsd(
							ceiling
						)} (${gated.flavor} at ${formatMicroUsd(price)}/min × ${minutes} min timeout), but only ${formatMicroUsd(
							remaining
						)} of the ${formatMicroUsd(
							reserveResult.budget.totalMicroUsd
						)} session budget remains. Nothing was submitted. If the user agreed to a raise in conversation, that did not change the ledger — only clicking an ask_user_question option that carries setBudgetUsd does. Lower the timeout or pick a cheaper flavor if that honestly fits the task; otherwise ask again with rescope options alongside an option carrying setBudgetUsd for the smallest amount that covers this run.`,
						update: budgetUpdate(reserveResult.budget),
					};
				}
				case "no_budget":
					// A mode conversation without a stored budget (created before
					// budgets existed) is a zero budget, not an unbudgeted one: spend
					// authority is granted, never assumed.
					return {
						allow: false,
						message: `Budget check: this session has no compute budget granted yet, so nothing can be submitted. This ${gated.kind} would need a worst case of ${formatMicroUsd(
							ceiling
						)}. If the user already agreed to a budget in conversation, that did not change the ledger — a grant only lands when they click an ask_user_question option that carries setBudgetUsd (a dollar amount written into a label does nothing). Ask with such an option, or point them at the budget field in the composer strip.`,
					};
			}
		},

		async after(rawTicket: unknown, outcome: GuardOutcome) {
			const ticket = rawTicket as Ticket;
			if (ticket.kind === "release") {
				// Only on success: a terminate that failed stopped nothing, and the
				// hold is still describing something that may still be running.
				if (outcome.status !== "success") return undefined;
				try {
					const current = await readMlBudget(conversationId);
					if (!current) return undefined;
					// The whole ledger, not just this stop's reservation: the pass
					// already knows how to ask the Jobs API what actually ran, and a
					// sibling that finished earlier in this turn settles for free.
					// A stop the API has not caught up with yet simply does not
					// settle here — the next generation's pass gets it.
					const settled = await settleMlBudget({
						conversationId,
						budget: current,
						...(token ? { token } : {}),
					});
					return settled === current ? undefined : budgetUpdate(settled);
				} catch (err) {
					logger.warn({ err: String(err) }, "[mlBudget] settle-on-stop failed; next turn will");
					return undefined;
				}
			}
			try {
				switch (outcome.status) {
					case "success": {
						const ref = extractJobRef(outcome.text, ticket.namespace ?? username);
						if (ref) {
							await attachJobToReservation({
								conversationId,
								key: ticket.key,
								jobId: ref.jobId,
								...(ref.namespace ? { namespace: ref.namespace } : {}),
							});
						} else {
							// Without a job id the reservation can never settle to actual
							// cost; it stays held and later settles at its full ceiling.
							logger.warn(
								{ key: ticket.key },
								"[mlBudget] submission succeeded but no job id was found in the response"
							);
						}
						break;
					}
					case "error":
					case "elicited":
						await releaseReservation({ conversationId, key: ticket.key });
						break;
					case "transport_error":
						// Whether the server launched the job is unknown: keep the hold.
						// If it did launch, settle finds it via the orphan path.
						logger.warn(
							{ key: ticket.key },
							"[mlBudget] submission fate unknown; keeping the reservation"
						);
						return undefined;
				}
				const budget = await readMlBudget(conversationId);
				return budget ? budgetUpdate(budget) : undefined;
			} catch (err) {
				// Bookkeeping must never break the tool round; the settle pass
				// reconciles anything missed here.
				logger.error({ err: String(err), key: ticket.key }, "[mlBudget] guard after() failed");
				return undefined;
			}
		},
	};
}
