import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import { isHfMcpServer } from "$lib/server/mcp/hf";
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

interface Ticket {
	key: string;
	kind: "job" | "sandbox";
	/** Namespace the submission targeted, when its arguments said so. */
	namespace?: string;
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
 * What this call is about to spend, or a refusal, or null for calls that spend
 * nothing (status, logs, ps, inspect, cancel, terminate, kill — reading and
 * stopping must work at any budget).
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
		if (operation !== "run" && operation !== "uv") return null;
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
		if (call.args.cmd !== "create") return null;
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
}: {
	conversationId: ObjectId;
	generationId: string;
	/** Fallback namespace for job ids reported without one. */
	username?: string;
}): ToolCallGuard {
	return {
		// The resume path re-invokes a parked tool without consulting any guard,
		// so a reserved call must fail closed out of it (see toolGuard.ts).
		allowParking: false,

		async before(call: GuardedToolCall): Promise<GuardVerdict> {
			if (!isHfMcpServer(call.serverUrl)) return { allow: true };
			const gated = classify(call);
			if (gated === null) return { allow: true };
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
						)} session budget remains. Nothing was submitted. Lower the timeout or pick a cheaper flavor if that honestly fits the task; otherwise put the trade-off to the user, who can also raise the session budget.`,
						update: budgetUpdate(reserveResult.budget),
					};
				}
				case "no_budget":
					// Only reachable if the budget was removed after this guard was
					// built; treat as unbudgeted rather than inventing a refusal.
					logger.warn(
						{ conversationId: String(conversationId) },
						"[mlBudget] gated call on a conversation with no budget"
					);
					return { allow: true };
			}
		},

		async after(rawTicket: unknown, outcome: GuardOutcome) {
			const ticket = rawTicket as Ticket;
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
