import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import { isHfMcpServer } from "$lib/server/mcp/hf";
import { classifySubmission, tokenAfter } from "$lib/server/mlBudget/guard";
import { isHelpReply, jobRefFromStructured, jobRefFromText } from "$lib/server/mlBudget/jobRef";
import { parseTimeoutSeconds } from "$lib/server/mlBudget/pricing";
import type {
	GuardedToolCall,
	GuardOutcome,
	GuardVerdict,
	ToolCallGuard,
} from "$lib/server/textGeneration/mcp/toolGuard";
import type { MlServiceKind } from "$lib/types/MlService";
import { fileUri, fileUrl, parseHfUri, repoUri, repoUrl } from "./hubUri";
import {
	ensureArtefact,
	hubJobUrl,
	recordArtefact,
	recordDiscoveredService,
	recordDispatchedService,
	sandboxHandle,
	UNKNOWN_STAGE,
} from "./store";

// books nothing in before and emits no update, so it can sit ahead of the budget guard
// a failed write is logged and never thrown, bookkeeping must not break the tool round

type SubmissionTicket = {
	kind: MlServiceKind;
	callUuid: string;
	reservationKey: string;
	name?: string;
	flavor?: string;
	timeoutSeconds?: number;
	namespace?: string;
};

type Ticket =
	| SubmissionTicket
	| { kind: "repo"; callUuid: string; uri: string }
	| { kind: "file"; callUuid: string; uri: string };

const JOB_ID = /^[0-9a-f]{24}$/;
const NAMESPACE = "[A-Za-z0-9][\\w.-]*";
const HANDLE_FORMS = [
	new RegExp(`^hfsb2:(${NAMESPACE}):([0-9a-f]{24})$`),
	new RegExp(`^(${NAMESPACE})/([0-9a-f]{24})$`),
];
const SANDBOX_TOOLS = new Set(["hf_sandbox", "hf_sandbox_exec", "hf_sandbox_fs"]);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;
const asNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;
const stringTokens = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : [];

/** name is an alias for labels.name on jobs */
function submissionName(call: GuardedToolCall): string | undefined {
	if (call.tool === "hf_jobs") {
		const jobArgs = asRecord(call.args.args);
		return asString(jobArgs?.name) ?? asString(asRecord(jobArgs?.labels)?.name);
	}
	return tokenAfter(stringTokens(call.args.args), "--name");
}

function sandboxRefFromTokens(
	tokens: string[],
	fallbackNamespace: string | undefined
): { namespace: string; jobId: string } | undefined {
	for (const token of tokens) {
		for (const form of HANDLE_FORMS) {
			const match = form.exec(token);
			if (match) return { namespace: match[1], jobId: match[2] };
		}
		if (JOB_ID.test(token) && fallbackNamespace)
			return { namespace: fallbackNamespace, jobId: token };
	}
	return undefined;
}

export function createMlRecordingGuard({
	conversationId,
	generationId,
	messageId,
	namespace,
}: {
	conversationId: ObjectId;
	generationId: string;
	messageId?: string;
	/** where compute runs by default, the billing namespace else the user */
	namespace?: string;
}): ToolCallGuard {
	const provenance = { generationId, ...(messageId ? { messageId } : {}) };

	function classify(call: GuardedToolCall): Ticket | undefined {
		if (call.tool === "hf_jobs" || call.tool === "hf_sandbox") {
			const gated = classifySubmission(call);
			if (!gated || "blocked" in gated) return undefined;
			const name = submissionName(call);
			const timeoutSeconds = parseTimeoutSeconds(gated.timeoutRaw);
			return {
				kind: gated.kind,
				callUuid: call.callUuid,
				reservationKey: `${generationId}:${call.callUuid}`,
				flavor: gated.flavor,
				...(name ? { name } : {}),
				...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
				...(gated.namespace ? { namespace: gated.namespace } : {}),
			};
		}
		if (call.tool === "create_repo") {
			const uri = asString(call.args.uri);
			return uri ? { kind: "repo", callUuid: call.callUuid, uri } : undefined;
		}
		if (call.tool === "hf_fs_write" && call.args.cmd === "put") {
			const uri = stringTokens(call.args.args).find((token) => token.startsWith("hf://"));
			return uri ? { kind: "file", callUuid: call.callUuid, uri } : undefined;
		}
		return undefined;
	}

	// covers submits lost in transport, jobs a script launched and older conversations
	async function discover(call: GuardedToolCall): Promise<void> {
		if (call.tool === "hf_jobs") {
			const jobArgs = asRecord(call.args.args);
			const jobId = asString(jobArgs?.job_id);
			if (!jobId || !JOB_ID.test(jobId)) return;
			const jobNamespace = asString(jobArgs?.namespace) ?? namespace;
			if (!jobNamespace) return;
			await recordDiscoveredService({
				conversationId,
				kind: "job",
				jobId,
				namespace: jobNamespace,
			});
			return;
		}
		if (!SANDBOX_TOOLS.has(call.tool)) return;
		if (call.tool === "hf_sandbox" && call.args.cmd === "create") return;
		const ref = sandboxRefFromTokens(stringTokens(call.args.args), namespace);
		if (!ref) return;
		await recordDiscoveredService({
			conversationId,
			kind: "sandbox",
			jobId: ref.jobId,
			namespace: ref.namespace,
			handle: sandboxHandle(ref.namespace, ref.jobId),
		});
	}

	async function recordSubmission(ticket: SubmissionTicket, outcome: GuardOutcome): Promise<void> {
		if (outcome.status !== "success") return;
		if (isHelpReply(outcome.structured)) return;
		const fallbackNamespace = ticket.namespace ?? namespace;
		const ref =
			jobRefFromStructured(ticket.kind, outcome.structured) ??
			jobRefFromText(outcome.text, fallbackNamespace);
		const jobNamespace = ref?.namespace ?? fallbackNamespace;
		if (!ref || !jobNamespace) {
			logger.warn(
				{ conversationId: conversationId.toString(), kind: ticket.kind, callUuid: ticket.callUuid },
				"[mlRegistry] submission succeeded but the reply named no job; nothing recorded"
			);
			return;
		}
		const root = asRecord(outcome.structured);
		const common = {
			conversationId,
			jobId: ref.jobId,
			namespace: jobNamespace,
			reservationKey: ticket.reservationKey,
			toolUuid: ticket.callUuid,
			...provenance,
		};
		if (ticket.kind === "job") {
			const job = asRecord(asRecord(root?.outcome)?.job);
			const status = asRecord(job?.status);
			const stageMessage = asString(status?.message);
			await recordDispatchedService({
				...common,
				kind: "job",
				stage: asString(status?.stage) ?? UNKNOWN_STAGE,
				...(stageMessage ? { stageMessage } : {}),
				flavor: asString(job?.flavor) ?? ticket.flavor,
				timeoutSeconds: asNumber(job?.timeout_seconds) ?? ticket.timeoutSeconds,
				hubUrl: asString(job?.url) ?? hubJobUrl(jobNamespace, ref.jobId),
				name: ticket.name,
			});
			return;
		}
		// the create reply carries no stage
		await recordDispatchedService({
			...common,
			kind: "sandbox",
			stage: UNKNOWN_STAGE,
			handle: asString(root?.handle) ?? sandboxHandle(jobNamespace, ref.jobId),
			flavor: ticket.flavor,
			timeoutSeconds: ticket.timeoutSeconds,
			hubUrl: asString(root?.job_url) ?? hubJobUrl(jobNamespace, ref.jobId),
			name: ticket.name ?? asString(root?.name),
		});
	}

	async function recordRepo(ticket: { uri: string; callUuid: string }, outcome: GuardOutcome) {
		if (outcome.status !== "success") return;
		const root = asRecord(outcome.structured);
		// the reply spells the uri canonically
		const parsed = parseHfUri(asString(root?.uri) ?? ticket.uri);
		if (!parsed) {
			logger.warn(
				{ conversationId: conversationId.toString(), uri: ticket.uri },
				"[mlRegistry] create_repo succeeded on a uri the registry cannot parse"
			);
			return;
		}
		await recordArtefact({
			conversationId,
			kind: parsed.kind,
			uri: repoUri(parsed),
			url: asString(root?.url) ?? repoUrl(parsed),
			toolUuid: ticket.callUuid,
			...provenance,
		});
	}

	async function recordFile(ticket: { uri: string; callUuid: string }, outcome: GuardOutcome) {
		if (outcome.status !== "success") return;
		const root = asRecord(outcome.structured);
		const parsed = parseHfUri(asString(root?.uri) ?? ticket.uri);
		if (!parsed?.path) {
			logger.warn(
				{ conversationId: conversationId.toString(), uri: ticket.uri },
				"[mlRegistry] hf_fs_write put succeeded on a uri the registry cannot parse"
			);
			return;
		}
		const withPath = { ...parsed, path: parsed.path };
		const commit = asString(asRecord(root?.commit)?.oid);
		// parent first so the repo sorts ahead of its files by createdAt
		await ensureArtefact({
			conversationId,
			kind: parsed.kind,
			uri: repoUri(parsed),
			url: repoUrl(parsed),
		});
		await recordArtefact({
			conversationId,
			kind: "file",
			uri: fileUri(withPath),
			url: fileUrl(withPath),
			...(commit ? { commit } : {}),
			toolUuid: ticket.callUuid,
			...provenance,
		});
	}

	return {
		allowParking: true,

		async before(call: GuardedToolCall): Promise<GuardVerdict> {
			if (!isHfMcpServer(call.serverUrl)) return { allow: true };
			try {
				await discover(call);
			} catch (err) {
				logger.error(
					{ err: String(err), conversationId: conversationId.toString(), tool: call.tool },
					"[mlRegistry] recording a discovered id failed"
				);
			}
			const ticket = classify(call);
			return ticket ? { allow: true, ticket } : { allow: true };
		},

		async after(rawTicket: unknown, outcome: GuardOutcome) {
			const ticket = rawTicket as Ticket;
			try {
				switch (ticket.kind) {
					case "job":
					case "sandbox":
						await recordSubmission(ticket, outcome);
						break;
					case "repo":
						await recordRepo(ticket, outcome);
						break;
					case "file":
						await recordFile(ticket, outcome);
						break;
				}
			} catch (err) {
				logger.error(
					{ err: String(err), conversationId: conversationId.toString(), kind: ticket.kind },
					"[mlRegistry] guard after() failed"
				);
			}
			return undefined;
		},
	};
}
