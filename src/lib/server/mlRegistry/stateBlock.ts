import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { mlVirtualFilesEnabled } from "$lib/server/mlFiles/enabled";
import { VIRTUAL_FILE_SCHEME } from "$lib/server/mlFiles/refs";
import { listMlFiles } from "$lib/server/mlFiles/store";
import type { Conversation } from "$lib/types/Conversation";
import type { MlArtefact } from "$lib/types/MlArtefact";
import type { MlFileListing } from "$lib/types/MlFile";
import type { MlService } from "$lib/types/MlService";
import {
	groupArtefacts,
	hubLabel,
	isTerminalStage,
	serviceDisplayName,
	serviceElapsed,
} from "$lib/utils/mlRegistry";
import {
	listMlArtefacts,
	listMlServices,
	markServicesReported,
	sandboxHandle,
	UNKNOWN_STAGE,
} from "./store";

export const SESSION_STATE_MAX_CHARS = 3_000;
const NAME_MAX_CHARS = 60;

export function mlStateBlockEnabled(conv: Pick<Conversation, "mlAssistant">): boolean {
	return isMlAssistantConversation(conv) && config.ML_ASSISTANT_STATE_BLOCK !== "false";
}

export interface SessionState {
	services: readonly MlService[];
	artefacts: readonly MlArtefact[];
	files: readonly MlFileListing[];
	now: Date;
}

export interface SessionStateBlock {
	text: string;
	/** ended rows the text lists, marked once read so each is listed once */
	ended: Pick<MlService, "_id" | "stage">[];
}

interface Section {
	title: string;
	rows: string[];
}

const truncate = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

const moreLine = (count: number) => `…and ${count} more`;

const formatSize = (bytes: number) =>
	bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

// the poller only gives a row up once it is past its timeout or cannot be read at all
const isEnded = (service: MlService) =>
	isTerminalStage(service.stage) || service.pollStoppedReason !== undefined;

const endTime = (service: MlService) => (service.endedAt ?? service.updatedAt).getTime();

function serviceStatus(service: MlService, now: Date): string {
	const lastSeen = service.stage === UNKNOWN_STAGE ? "" : `, last seen ${service.stage}`;
	// a row stopped for want of a token keeps tokenMissingSince so stopped is checked first
	if (service.pollStoppedReason && !isTerminalStage(service.stage)) {
		return `no longer tracked${lastSeen}`;
	}
	if (service.tokenMissingSince) return `status unknown: the user's session expired${lastSeen}`;
	if (service.stage === UNKNOWN_STAGE) return "status not checked yet";
	const elapsed = serviceElapsed(service, now.getTime());
	if (service.stage === "SCHEDULING") return elapsed ?? "queued";
	if (!elapsed) return service.stage;
	return isTerminalStage(service.stage)
		? `${service.stage} after ${elapsed}`
		: `${service.stage} ${elapsed}`;
}

function serviceLine(service: MlService, now: Date): string {
	const discovered = service.origin === "discovered" ? " (seen in a call, not launched here)" : "";
	const parts = [
		`${service.kind} ${truncate(serviceDisplayName(service), NAME_MAX_CHARS)}${discovered}`,
	];
	if (!isEnded(service) && service.flavor) parts.push(service.flavor);
	parts.push(serviceStatus(service, now));
	parts.push(
		service.kind === "sandbox"
			? (service.handle ?? sandboxHandle(service.namespace, service.jobId))
			: `id ${service.jobId}`
	);
	return `- ${parts.join(" · ")}`;
}

function artefactRows(artefacts: readonly MlArtefact[]): string[] {
	const { repos, orphans, dashboards } = groupArtefacts(artefacts);
	return [
		...repos.map(({ repo, files }) => {
			const count = files.length
				? ` (${files.length} ${files.length === 1 ? "file" : "files"})`
				: "";
			const discovered =
				repo.origin === "discovered" ? " (written to, not created by a call here)" : "";
			return `- ${repo.kind} ${hubLabel(repo.uri)}${count}${discovered}`;
		}),
		...orphans.map((file) => `- file ${file.uri}`),
		...dashboards.map((dashboard) => `- dashboard ${hubLabel(dashboard.uri)}`),
	];
}

/** a long section can shorten the ones after it but never hide them */
function fitSections(
	head: string,
	sections: Section[],
	maxChars: number
): { text: string; shown: number[] } {
	const floor = (section: Section) =>
		section.title.length + 1 + moreLine(section.rows.length).length + 1;
	const lines = [head];
	let used = head.length;
	const shown = sections.map((section, index) => {
		const reserved = sections.slice(index + 1).reduce((sum, later) => sum + floor(later), 0);
		lines.push(section.title);
		used += section.title.length + 1;
		let count = 0;
		for (const row of section.rows) {
			const cutAfter = section.rows.length - count - 1;
			const needed = row.length + 1 + (cutAfter > 0 ? moreLine(cutAfter).length + 1 : 0);
			if (used + needed + reserved > maxChars) break;
			lines.push(row);
			used += row.length + 1;
			count++;
		}
		const cut = section.rows.length - count;
		if (cut > 0) {
			lines.push(moreLine(cut));
			used += moreLine(cut).length + 1;
		}
		return count;
	});
	return { text: lines.join("\n"), shown };
}

/** pure because the pinned head of the history cap is meant to reuse it */
export function renderSessionStateBlock({
	services,
	artefacts,
	files,
	now,
}: SessionState): SessionStateBlock | undefined {
	const open = services
		.filter((service) => !isEnded(service))
		.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	const ended = services
		.filter((service) => isEnded(service) && service.lastReportedStage !== service.stage)
		.sort((a, b) => endTime(b) - endTime(a));

	const endedSection: Section = {
		title: "Newly ended (listed once):",
		rows: ended.map((s) => serviceLine(s, now)),
	};
	const sections = [
		{ title: "Running and queued:", rows: open.map((s) => serviceLine(s, now)) },
		endedSection,
		{ title: "Created on the Hub:", rows: artefactRows(artefacts) },
		{
			title: "Virtual files:",
			rows: files.map(
				(file) => `- ${VIRTUAL_FILE_SCHEME}${file.name} v${file.version} · ${formatSize(file.size)}`
			),
		},
	].filter((section) => section.rows.length > 0);
	if (sections.length === 0) return undefined;

	const head =
		"[SESSION STATE — kept by the harness from the calls it dispatched and the Hub's job " +
		`status, not written by the user. As of ${now.toISOString().slice(11, 16)} UTC.]`;
	const { text, shown } = fitSections(head, sections, SESSION_STATE_MAX_CHARS);
	const endedShown = shown[sections.indexOf(endedSection)] ?? 0;
	return {
		text,
		// a row the cap cut stays unreported and comes up in a later block
		ended: ended.slice(0, endedShown).map(({ _id, stage }) => ({ _id, stage })),
	};
}

/** never throws, a failed read must not fail the turn */
export async function buildSessionStateBlock(
	conv: Pick<Conversation, "_id" | "mlAssistant">,
	now = new Date()
): Promise<SessionStateBlock | undefined> {
	try {
		const [services, artefacts, files] = await Promise.all([
			listMlServices(conv._id),
			listMlArtefacts(conv._id),
			// a reference nothing expands would reach the hub as a literal
			mlVirtualFilesEnabled(conv) ? listMlFiles(conv._id) : [],
		]);
		return renderSessionStateBlock({ services, artefacts, files, now });
	} catch (err) {
		logger.warn(
			{ err: String(err), conversationId: conv._id.toString() },
			"[mlRegistry] could not read the session state, the turn runs without it"
		);
		return undefined;
	}
}

/** a failed write lists the rows again next run, a repeat beats a missed failure */
export async function markSessionStateRead(ended: SessionStateBlock["ended"]): Promise<void> {
	if (ended.length === 0) return;
	try {
		await markServicesReported(ended);
	} catch (err) {
		logger.warn(
			{ err: String(err), services: ended.length },
			"[mlRegistry] could not mark the session state as read, its ended rows will repeat"
		);
	}
}

/** never the system prompt, which is the stable cache prefix */
export function injectSessionState(
	messages: ChatCompletionMessageParam[],
	block: string
): ChatCompletionMessageParam[] {
	const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
	if (lastUserIndex === -1) return messages;
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
