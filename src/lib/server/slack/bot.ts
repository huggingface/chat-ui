import { eligibleParticipant } from "./access";
import { ConnectionError } from "./links";
import {
	chatLink,
	chatOrigin,
	createConnectionLink,
	connectionKey,
	connectedLocals,
	linkedSessionId,
} from "./connections";
import { viewerLink, viewerConfig } from "./viewer/auth";
import { isHttpError } from "@sveltejs/kit";
import { downloadAttachments } from "./attachments";
import { AbortRegistry } from "$lib/server/abortRegistry";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { App } from "@slack/bolt";
import { z } from "zod";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { base } from "$app/paths";
import { onExit } from "$lib/server/exitHandler";
import { logger } from "$lib/server/logger";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";
import { pinnedHubToken } from "$lib/server/mlAssistant";
import { isTurnAlive } from "$lib/server/generation/turnLog";
import { kickAnsweredAsk } from "$lib/server/generation/askResume";
import {
	QueueFullError,
	QueuedInputTooLongError,
	enqueueInput as queueForTurn,
	hasQueuedInputs,
} from "$lib/server/queuedInputs/store";
import { wakeParkForQueuedInput } from "$lib/server/queuedInputs/deliver";
import { kickQueuedTurn } from "$lib/server/queuedInputs/drain";
import { submitElicitationAnswer } from "$lib/server/mcp/elicitation";
import { reservedMicroUsd, formatMicroUsd } from "$lib/utils/mlBudget";
import type { User } from "$lib/types/User";
import { slackConfig, type SlackConfig } from "./config";
import { provisionSlackIdentity, threadLocals } from "./identity";
import { answerSideQuestion, SIDE_QUESTION_MAX_CHARS } from "$lib/server/mlSideQuestion";
import { slackSideQuestion } from "$lib/utils/sideQuestion";
import { ensureConversation, runSlackTurn, stopSlackTurn, skipSlackQuestion } from "./engine";
import { MCP_RESYNC_NOTE } from "$lib/server/mcp/savedSelection";
import { addressedToOther, threadKey, threadPrompt, type ThreadMessage } from "./context";
import { enqueueInput, getOrCreateThread, inputKey, SlackLeader } from "./store";
import type { SlackThread } from "./types";
import {
	PICK_ACTION,
	SELECT_ACTION,
	SUBMIT_ACTION,
	inlineQuestions,
	selectedAnswers,
	retainPublicUpdates,
	createdSpaceLinks,
	inlineField,
	questionBlocks,
	questionFormLabel,
	confirmedQuestionBlocks,
	ANSWER_ACTION,
	ANSWER_VIEW,
	STOP_ACTION,
	RESUME_ACTION,
	chunks,
	messageBlocks,
	questionModal,
	readAnswers,
	visibleText,
	runFailureText,
} from "./presentation";

function parseMetadata(raw: string | undefined): unknown {
	try {
		return JSON.parse(raw ?? "null");
	} catch {
		return null;
	}
}

const metadata = z.object({ threadId: z.string().max(200), elicitationId: z.string().uuid() });
const turnAction = z.object({
	threadId: z.string().max(200),
	messageId: z.string().uuid(),
	generationId: z.string().uuid().optional(),
});
const mention = z.object({
	channel: z.string(),
	user: z.string(),
	user_team: z.string().optional(),
	text: z.string().max(40_000),
	ts: z.string().regex(/^\d+\.\d+$/),
	thread_ts: z
		.string()
		.regex(/^\d+\.\d+$/)
		.optional(),
	bot_id: z.string().optional(),
	subtype: z.string().optional(),
	channel_type: z.string().optional(),
});

/** shared slack credentials pay for these, so they are capped per asker and per workspace */
const MAX_SLACK_SIDE_QUESTIONS = 4;
const SLACK_SIDE_QUESTIONS_PER_MINUTE = 5;
const SLACK_WORKSPACE_SIDE_QUESTIONS_PER_MINUTE = 20;
const SLACK_SIDE_QUESTION_TIMEOUT_MS = 90_000;

const conversationLink = (conversationId: ObjectId) =>
	`${config.PUBLIC_ORIGIN}${base}/conversation/${conversationId.toString()}`;

/** Transport and delivery only. ML Intern's existing engine owns tool execution and resume. */
export class MlSlackBot {
	readonly app: App;
	private botUserId = "";
	private active = new Map<string, Promise<void>>();
	private runningConversations = new Map<string, string>();
	private eventMembership = new Map<
		string,
		{ user: NonNullable<Awaited<ReturnType<typeof eligibleParticipant>>>; until: number }
	>();
	private eventRates = new Map<string, { count: number; until: number; notified?: boolean }>();
	private linkPrompts = new Map<string, number>();
	private sideQuestionEvents = new Map<string, number>();
	private sideQuestionAskers = new Set<string>();
	private ticking = false;
	private renders = new Map<string, Promise<void>>();
	private timer?: ReturnType<typeof setInterval>;
	private stopped = false;
	private statusIntervalMs = 10000;
	constructor(
		readonly settings: SlackConfig,
		readonly user?: User
	) {
		this.app = new App({
			token: settings.botToken,
			appToken: settings.appToken,
			socketMode: true,
			// Don't log Slack payloads, which can contain private thread text or answers.
			logger: {
				debug() {},
				info() {},
				warn() {
					logger.warn("[slack] SDK warning");
				},
				error() {
					logger.error("[slack] SDK error");
				},
				setLevel() {},
				getLevel() {
					return "error" as import("@slack/bolt").LogLevel;
				},
				setName() {},
			},
		});
		this.register();
	}

	private async participant(thread: SlackThread, userId: string) {
		const participant = await eligibleParticipant(
			this.app.client,
			{ ...this.settings, accountMode: thread.hfUserId ? this.settings.accountMode : "shared" },
			userId,
			thread.channel
		);
		if (
			thread.hfUserId &&
			userId === thread.owner &&
			participant?.team_id !== (thread.ownerTeamId ?? thread.teamId)
		)
			return;
		return participant;
	}

	/** event-path eligibility with a 60 s positive cache; dispatch and controls recheck uncached */
	private async cachedParticipant(mode: SlackConfig["accountMode"], channel: string, user: string) {
		const now = Date.now();
		for (const [key, value] of this.eventMembership)
			if (value.until <= now) this.eventMembership.delete(key);
		const cacheKey = `${mode}:${channel}:${user}`;
		const cached = this.eventMembership.get(cacheKey)?.user;
		if (cached) return cached;
		const participant = await eligibleParticipant(
			this.app.client,
			{ ...this.settings, accountMode: mode },
			user,
			channel
		);
		if (participant && this.eventMembership.size < 5000)
			this.eventMembership.set(cacheKey, { user: participant, until: now + 60_000 });
		return participant;
	}

	private async reconnectionLink(thread: SlackThread) {
		const user = await eligibleParticipant(
			this.app.client,
			this.settings,
			thread.owner,
			thread.channel
		);
		if (!user?.team_id) return;
		return createConnectionLink(thread.teamId, thread.owner, {
			userTeamId: user.team_id,
			channel: thread.channel,
		});
	}

	private async owned(
		threadId: string,
		userId: string,
		teamId: string | undefined,
		requireConnection = true
	): Promise<SlackThread | null> {
		const thread = await collections.slackThreads.findOne({
			_id: threadId,
			teamId: this.settings.teamId,
			owner: userId,
		});
		if (!thread) return null;
		const participant = await this.participant(thread, userId);
		if (!participant || (teamId !== this.settings.teamId && teamId !== participant.team_id))
			return null;
		if (thread?.deletedAt) return null;
		if (thread?.hfUserId && requireConnection) {
			try {
				await connectedLocals(thread);
			} catch (error) {
				await this.tell(
					thread.channel,
					userId,
					error instanceof ConnectionError
						? "Reconnect the original Hugging Face account before answering or resuming this session."
						: "Could not verify your connection. Please try again shortly.",
					thread.threadTs
				);
				return null;
			}
		}
		return thread;
	}

	private async tell(
		channel: string,
		user: string,
		text: string,
		threadTs?: string
	): Promise<void> {
		await this.app.client.chat.postEphemeral({
			channel,
			user,
			text,
			...(threadTs ? { thread_ts: threadTs } : {}),
		});
	}

	private register(): void {
		this.app.action("ml_intern_view", async ({ ack }) => {
			await ack();
		});
		this.app.event("app_mention", async ({ event, body }) => {
			await this.receive(event, body.team_id, body.event_id);
		});
		this.app.event("message", async ({ event, body }) => {
			if (
				("channel_type" in event && event.channel_type === "im") ||
				(await this.isOwnerFollowUp(event, body.team_id))
			)
				await this.receive(event, body.team_id, body.event_id);
		});

		for (let f = 0; f < 5; f++)
			for (let i = 0; i < 5; i++)
				this.app.action(`${SELECT_ACTION}${f}_${i}`, async ({ ack, body, action }) => {
					await ack();
					if (!("value" in action)) return;
					const parsed = metadata
						.extend({
							fieldIndex: z.number().int().min(0).max(4),
							optionIndex: z.number().int().min(0).max(4),
						})
						.safeParse(parseMetadata(action.value));
					if (!parsed.success) return;
					const thread = await this.owned(parsed.data.threadId, body.user.id, body.team?.id);
					if (!thread) return;
					const question = await collections.mcpElicitations.findOne({
						conversationId: thread.conversationId,
						elicitationId: parsed.data.elicitationId,
						status: "pending",
						"pending.kind": "ask",
					});
					if (!question || !inlineQuestions(question.request)) return;
					const field = question.request.fields?.[parsed.data.fieldIndex];
					if (field?.kind !== "select" || !field.options[parsed.data.optionIndex]) return;
					await collections.mcpElicitations.updateOne(
						{ _id: question._id, status: "pending", slackSubmitting: { $ne: true } },
						{
							$set: { [`slackChoices.${parsed.data.fieldIndex}`]: parsed.data.optionIndex },
							$inc: { slackChoiceRevision: 1 },
						}
					);
					await collections.slackThreads.updateOne(
						{ _id: thread._id },
						{ $set: { watching: true } }
					);
					await this.render(thread).catch(() =>
						logger.warn("[slack] Immediate selection update failed; polling will retry.")
					);
				});
		this.app.action(SUBMIT_ACTION, async ({ ack, body, action }) => {
			await ack();
			if (!("value" in action)) return;
			const parsed = metadata
				.extend({ revision: z.number().int().min(1) })
				.safeParse(parseMetadata(action.value));
			if (!parsed.success) return;
			const thread = await this.owned(parsed.data.threadId, body.user.id, body.team?.id);
			if (!thread) return;
			const question = await collections.mcpElicitations.findOne({
				conversationId: thread.conversationId,
				elicitationId: parsed.data.elicitationId,
				status: "pending",
				"pending.kind": "ask",
			});
			const content = question && selectedAnswers(question.request, question.slackChoices);
			if (!question || !content || question.slackChoiceRevision !== parsed.data.revision) return;
			const locked = await collections.mcpElicitations.updateOne(
				{
					_id: question._id,
					status: "pending",
					slackChoiceRevision: parsed.data.revision,
					slackSubmitting: { $ne: true },
				},
				{ $set: { slackSubmitting: true, slackShareAnswer: true } }
			);
			if (!locked.modifiedCount) {
				await this.tell(
					thread.channel,
					body.user.id,
					"Your selections changed or were already submitted. Review the current choices and submit again."
				);
				return;
			}
			try {
				const result = await submitElicitationAnswer({
					conversationId: thread.conversationId,
					elicitationId: question.elicitationId,
					action: "accept",
					content,
				});
				if (result.ok && result.resume)
					await enqueueInput({
						_id: inputKey(this.settings.teamId, `answer:${question.elicitationId}`),
						threadId: thread._id,
						user: body.user.id,
						text: "",
						ts: thread.threadTs,
						resumeElicitationId: question.elicitationId,
					});
			} finally {
				await collections.mcpElicitations.updateOne(
					{ _id: question._id },
					{ $unset: { slackSubmitting: "" } }
				);
				await collections.slackThreads.updateOne({ _id: thread._id }, { $set: { watching: true } });
			}
		});
		for (let i = 0; i < 5; i++)
			this.app.action(`${PICK_ACTION}${i}`, async ({ ack, body, action }) => {
				await ack();
				if (!("value" in action)) return;
				const parsed = metadata
					.extend({ optionIndex: z.number().int().min(0).max(4) })
					.safeParse(parseMetadata(action.value));
				if (!parsed.success) return;
				const thread = await this.owned(parsed.data.threadId, body.user.id, body.team?.id);
				if (!thread) return;
				const question = await collections.mcpElicitations.findOne({
					conversationId: thread.conversationId,
					elicitationId: parsed.data.elicitationId,
					status: "pending",
					"pending.kind": "ask",
				});
				const field = question && inlineField(question.request);
				const option = field && field.options[parsed.data.optionIndex];
				if (!question || !field || !option) return;
				await collections.mcpElicitations.updateOne(
					{ _id: question._id, status: "pending" },
					{ $set: { slackShareAnswer: true } }
				);
				const result = await submitElicitationAnswer({
					conversationId: thread.conversationId,
					elicitationId: question.elicitationId,
					action: "accept",
					content: { [field.name]: option.value },
				});
				if (!result.ok) {
					await this.tell(
						thread.channel,
						body.user.id,
						"This answer could not be applied, or the question was already answered. Please check the current question."
					);
					return;
				}
				if (result.resume)
					await enqueueInput({
						_id: inputKey(this.settings.teamId, `answer:${question.elicitationId}`),
						threadId: thread._id,
						user: body.user.id,
						text: "",
						ts: thread.threadTs,
						resumeElicitationId: question.elicitationId,
					});
				await collections.slackThreads.updateOne(
					{ _id: thread._id },
					{ $set: { watching: true, updatedAt: new Date() } }
				);
			});
		this.app.action(ANSWER_ACTION, async ({ ack, body, action }) => {
			await ack();
			if (!("value" in action) || !("trigger_id" in body)) return;
			const parsed = metadata.safeParse(parseMetadata(action.value));
			if (!parsed.success) return;
			const thread = await this.owned(parsed.data.threadId, body.user.id, body.team?.id);
			if (!thread) return;
			const question = await collections.mcpElicitations.findOne({
				conversationId: thread.conversationId,
				elicitationId: parsed.data.elicitationId,
				status: "pending",
			});
			if (question?.pending?.kind === "review") {
				await this.tell(
					thread.channel,
					body.user.id,
					`Reviews are submitted on the web: ${conversationLink(thread.conversationId)}`
				);
				return;
			}
			if (!question || question.request.mode !== "form") {
				await this.tell(
					thread.channel,
					body.user.id,
					"This question has already been answered or expired."
				);
				return;
			}
			await this.app.client.views.open({
				trigger_id: body.trigger_id,
				view: questionModal(question.request, thread._id),
			});
		});
		this.app.view(ANSWER_VIEW, async ({ ack, body, view }) => {
			const parsed = metadata.safeParse(parseMetadata(view.private_metadata));
			if (!parsed.success) {
				await ack({ response_action: "clear" });
				return;
			}
			const thread = await this.owned(parsed.data.threadId, body.user.id, body.team?.id);
			if (!thread) {
				await ack({ response_action: "clear" });
				return;
			}
			const question = await collections.mcpElicitations.findOne({
				conversationId: thread.conversationId,
				elicitationId: parsed.data.elicitationId,
			});
			if (!question) {
				await ack({ response_action: "clear" });
				return;
			}
			const answer = readAnswers(question.request, view.state.values);
			if (Object.keys(answer.errors).length) {
				await ack({ response_action: "errors", errors: answer.errors });
				return;
			}
			if (question.pending?.kind === "ask")
				await collections.mcpElicitations.updateOne(
					{ _id: question._id, status: "pending" },
					{ $set: { slackShareAnswer: true } }
				);

			const result = await submitElicitationAnswer({
				conversationId: thread.conversationId,
				elicitationId: question.elicitationId,
				action: "accept",
				content: answer.content,
			});
			if (!result.ok && result.status !== 409) {
				await ack({ response_action: "errors", errors: { q0: result.error } });
				return;
			}
			// Persist wake intent before acknowledging Slack. A restart cannot lose the answer.
			const resumes = result.ok ? result.resume : result.answered?.resume;
			if (resumes) {
				await enqueueInput({
					_id: inputKey(this.settings.teamId, `answer:${question.elicitationId}`),
					threadId: thread._id,
					user: body.user.id,
					text: "",
					ts: thread.threadTs,
					resumeElicitationId: question.elicitationId,
				});
			} else {
				await collections.slackThreads.updateOne(
					{ _id: thread._id },
					{ $set: { watching: true, updatedAt: new Date() } }
				);
			}
			await ack();
		});
		this.app.action(STOP_ACTION, async ({ ack, body, action }) => {
			await ack();
			if (!("value" in action)) return;
			const parsed = turnAction.safeParse(parseMetadata(action.value));
			if (!parsed.success) return;
			const thread = await this.owned(parsed.data.threadId, body.user.id, body.team?.id, false);
			if (!thread) return;
			const conv = await collections.conversations.findOne({ _id: thread.conversationId });
			if (conv?.messages.at(-1)?.id !== parsed.data.messageId) return;
			const owner = thread.hfUserId
				? await collections.users.findOne({ _id: thread.hfUserId })
				: this.user;
			if (!owner) return;
			await stopSlackTurn(thread, owner);
			await this.tell(
				thread.channel,
				body.user.id,
				"Stopped the assistant. Jobs already running on Hugging Face keep running until cancelled or timed out.",
				thread.threadTs
			);
		});
		this.app.action(RESUME_ACTION, async ({ ack, body, action }) => {
			await ack();
			if (!("value" in action)) return;
			const parsed = turnAction.safeParse(parseMetadata(action.value));
			if (!parsed.success) return;
			const thread = await this.owned(parsed.data.threadId, body.user.id, body.team?.id);
			if (!thread) return;
			const conv = await collections.conversations.findOne({ _id: thread.conversationId });
			const last = conv?.messages[conv.messages.length - 1];
			if (
				!last ||
				last.id !== parsed.data.messageId ||
				last.generationId !== parsed.data.generationId ||
				(await isTurnAlive(thread.conversationId, last.id)).alive
			)
				return;
			const state = await collections.turnStates.findOne({
				conversationId: thread.conversationId,
				messageId: last.id,
			});
			if (!last.interrupted && state?.status !== "failed") return;
			await enqueueInput({
				_id: inputKey(this.settings.teamId, `retry:${thread._id}:${last.generationId}`),
				threadId: thread._id,
				user: body.user.id,
				text: "",
				ts: thread.threadTs,
				retry: true,
				expectedMessageId: last.id,
				expectedGenerationId: last.generationId,
			});
		});
		this.app.action("ml_intern_trace", async ({ ack, body, action }) => {
			await ack();
			if (!("value" in action)) return;

			const thread = await collections.slackThreads.findOne({
				_id: action.value ?? "",
				teamId: this.settings.teamId,
			});
			if (!thread || !("channel" in body) || body.channel?.id !== thread.channel) return;
			if (thread.hfUserId && thread.owner !== body.user.id) return;
			const participant = await this.participant(thread, body.user.id);
			if (
				!participant ||
				(body.team?.id !== this.settings.teamId && body.team?.id !== participant.team_id)
			)
				return;
			// Personal traces and DMs are owner-only; legacy channel traces remain shared.
			if ((thread.hfUserId || thread.channel.startsWith("D")) && thread.owner !== body.user.id)
				return;
			if (
				this.settings.allowedChannels.length &&
				!this.settings.allowedChannels.includes(thread.channel)
			)
				return;
			const channel = await this.app.client.conversations.info({ channel: thread.channel });
			if (channel.channel?.is_ext_shared && !thread.hfUserId) return;
			const conv = await collections.conversations.findOne({ _id: thread.conversationId });
			if (!conv) return;
			try {
				// Personal traces include private tool results: deliver only to the owner DM.
				const destination = thread.hfUserId
					? (await this.app.client.conversations.open({ users: thread.owner })).channel?.id
					: thread.channel;
				if (!destination) return;
				const upload = {
					filename: `ml-intern-${conv._id}.jsonl`,
					content: conv.messages.map((m) => JSON.stringify(m)).join("\n"),
					title: "ML Intern conversation trace",
				};
				if (thread.hfUserId) {
					await this.app.client.files.uploadV2({ ...upload, channel_id: destination });
				} else {
					await this.app.client.files.uploadV2({
						...upload,
						channel_id: destination,
						thread_ts: thread.threadTs,
					});
				}
			} catch {
				await this.tell(
					thread.channel,
					body.user.id,
					"Could not deliver the trace. For personal traces, the Slack app needs im:write and files:write permissions; an administrator may need to reinstall it. Please try again after checking the installation.",
					thread.threadTs
				);
			}
		});
		this.app.error(async () => {
			logger.error("[slack] Could not handle a Slack event; no credentials or payload logged.");
		});
	}

	/**
	 * the owner's unmentioned replies in a bot thread act like chat messages: they steer a running
	 * turn or start the next one. Mentions are left to app_mention so a message is handled once.
	 */
	private async isOwnerFollowUp(raw: unknown, teamId: string): Promise<boolean> {
		const parsed = mention.safeParse(raw);
		if (!parsed.success || teamId !== this.settings.teamId || !this.botUserId) return false;
		const { channel, user, text, ts, thread_ts } = parsed.data;
		if (!thread_ts || thread_ts === ts || text.includes(`<@${this.botUserId}>`)) return false;
		const thread = await collections.slackThreads.findOne(
			{ _id: threadKey(teamId, channel, thread_ts) },
			{ projection: { owner: 1, deletedAt: 1 } }
		);
		return !!thread && !thread.deletedAt && thread.owner === user;
	}

	async receive(raw: unknown, teamId: string, eventId: string): Promise<void> {
		const parsed = mention.safeParse(raw);
		if (!parsed.success || teamId !== this.settings.teamId) return;
		const event = parsed.data;
		if (
			event.bot_id ||
			(event.subtype && !["file_share", "thread_broadcast"].includes(event.subtype)) ||
			event.user === this.botUserId
		)
			return;
		if (
			this.settings.allowedChannels.length &&
			!this.settings.allowedChannels.includes(event.channel)
		)
			return;
		const existing = await collections.slackThreads.findOne({
			teamId,
			channel: event.channel,
			threadTs: event.thread_ts ?? event.ts,
		});
		// Bound traffic before any Slack API lookup. Local owner checks also keep non-owners
		// from consuming paginated membership checks on existing sessions. The owner steering
		// their own thread is exempt: dropping it would demote their instruction to quoted context.
		const now = Date.now();
		if (!existing || existing.deletedAt || existing.owner !== event.user) {
			for (const [key, value] of this.eventRates)
				if (value.until <= now) this.eventRates.delete(key);
			const rate = this.eventRates.get(event.user) ?? { count: 0, until: now + 60_000 };
			if (rate.count >= 10 || (!this.eventRates.has(event.user) && this.eventRates.size >= 5000)) {
				if (rate.count >= 10 && !rate.notified) {
					rate.notified = true;
					await this.tell(
						event.channel,
						event.user,
						"You're sending messages to ML Intern too quickly. Wait a minute, then send that again.",
						event.thread_ts
					).catch(() => {});
				}
				return;
			}
			rate.count++;
			this.eventRates.set(event.user, rate);
		}
		if (existing?.hfUserId && existing.owner !== event.user) {
			await this.tell(
				event.channel,
				event.user,
				"Only the session owner can make requests using their personal Hugging Face account. Start your own thread to use yours.",
				event.thread_ts
			);
			return;
		}
		const mode = existing && !existing.hfUserId ? "shared" : this.settings.accountMode;
		const participant = await this.cachedParticipant(mode, event.channel, event.user);
		if (
			!participant ||
			(event.user_team && event.user_team !== participant.team_id) ||
			(existing?.hfUserId && participant.team_id !== (existing.ownerTeamId ?? existing.teamId))
		)
			return;
		// Dispatch and controls recheck membership without this event-only cache.
		// In a DM every message is for the bot, even one that opens by tagging a colleague.
		if (
			event.channel_type !== "im" &&
			this.botUserId &&
			addressedToOther(event.text, this.botUserId)
		) {
			await this.tell(
				event.channel,
				event.user,
				"Tagging a person or group at the beginning of a message means your message will not be sent to ML Intern.",
				event.thread_ts
			);
			return;
		}

		if (existing?.deletedAt) {
			await this.tell(
				event.channel,
				event.user,
				"This conversation was deleted by its owner. Start a new Slack thread.",
				event.thread_ts
			);
			return;
		}

		if (existing && !existing.hfUserId && !this.user) {
			await this.tell(
				event.channel,
				event.user,
				"This legacy session needs the original shared HF token configured by the operator. Start a new thread to use your own account.",
				event.thread_ts
			);
			return;
		}
		const question = slackSideQuestion(event.text, this.botUserId);
		if (question !== undefined && (await this.answerSideQuestion(event, teamId, eventId, question)))
			return;
		let hfUserId = existing?.hfUserId;
		if (this.settings.accountMode === "user" && !existing) {
			const connection = await collections.slackConnections.findOne({
				_id: connectionKey(teamId, event.user, participant.team_id),
			});
			if (
				!connection ||
				(connection.userTeamId ?? connection.teamId) !== (participant.team_id ?? teamId)
			) {
				const now = Date.now();
				for (const [user, until] of this.linkPrompts)
					if (until <= now) this.linkPrompts.delete(user);
				if (this.linkPrompts.has(event.user)) return;
				this.linkPrompts.set(event.user, now + 30000);
				const link = await createConnectionLink(teamId, event.user, {
					userTeamId: participant.team_id ?? teamId,
					channel: event.channel,
				});
				await this.tell(
					event.channel,
					event.user,
					`<${link}|Connect Hugging Face> to start sessions in your HuggingChat history using your own account. Then mention me again.`,
					// Ephemeral-only replies do not create a visible thread in Slack.
					event.thread_ts
				);
				return;
			}
			hfUserId = connection.userId;
		}
		const thread = await getOrCreateThread(
			teamId,
			event.channel,
			event.thread_ts ?? event.ts,
			event.user,
			hfUserId,
			participant.team_id ?? teamId
		);
		const inserted = await enqueueInput({
			_id: inputKey(teamId, eventId),
			threadId: thread._id,
			user: event.user,
			text: event.text,
			ts: event.ts,
		});
		if (inserted) {
			await this.app.client.reactions
				.add({ channel: event.channel, timestamp: event.ts, name: "eyes" })
				.catch(() =>
					logger.warn(
						"[slack] Reaction failed; request remains queued. Check reactions:write permission."
					)
				);
		}
	}

	/**
	 * answered beside the run, never queued, and never part of the next turn's thread context,
	 * false when the thread has no task so the message goes on as an ordinary request
	 */
	private async answerSideQuestion(
		event: z.infer<typeof mention>,
		teamId: string,
		eventId: string,
		question: string
	): Promise<boolean> {
		const thread = await collections.slackThreads.findOne({
			_id: threadKey(teamId, event.channel, event.thread_ts ?? event.ts),
			teamId,
		});
		const exists =
			thread &&
			(await collections.conversations.countDocuments(
				{ _id: thread.conversationId },
				{ limit: 1 }
			));
		if (!thread || !exists) return false;

		const now = Date.now();
		for (const [id, until] of this.sideQuestionEvents)
			if (until <= now) this.sideQuestionEvents.delete(id);
		if (this.sideQuestionEvents.has(eventId)) return true;
		this.sideQuestionEvents.set(eventId, now + 10 * 60_000);
		await collections.slackThreads.updateOne(
			{ _id: thread._id },
			{ $push: { sideQuestionTs: { $each: [event.ts], $slice: -200 } } }
		);

		const refuse = (text: string) =>
			this.tell(event.channel, event.user, text, thread.threadTs).then(() => true);
		if (!question) return refuse("Add your question after /btw, e.g. `/btw which job is running?`");
		if (question.length > SIDE_QUESTION_MAX_CHARS)
			return refuse(`Keep btw questions under ${SIDE_QUESTION_MAX_CHARS} characters.`);
		if (
			this.sideQuestionAskers.has(event.user) ||
			this.sideQuestionAskers.size >= MAX_SLACK_SIDE_QUESTIONS
		)
			return refuse(
				"ML Intern is still answering another btw question. Try again once it replies."
			);
		// claimed before the next await so a second request from the same asker sees it
		this.sideQuestionAskers.add(event.user);
		try {
			if (!(await this.reserveSideQuestion(teamId, event.user)))
				return await refuse("Too many btw questions in the last minute. Try again shortly.");
			await this.app.client.reactions
				.add({ channel: event.channel, timestamp: event.ts, name: "eyes" })
				.catch(() => {});
			let answer = "";
			for await (const chunk of answerSideQuestion({
				conversationId: thread.conversationId,
				question,
				locals: await threadLocals(thread, this.user),
				signal: AbortSignal.timeout(SLACK_SIDE_QUESTION_TIMEOUT_MS),
			}))
				answer += chunk;
			for (const text of chunks(`_btw answer, ML Intern does not see this_\n\n${answer.trim()}`)) {
				await this.app.client.chat.postMessage({
					channel: thread.channel,
					thread_ts: thread.threadTs,
					text,
					blocks: messageBlocks(text, []),
					parse: "none",
					unfurl_links: false,
					unfurl_media: false,
				});
			}
		} catch (error) {
			const status = isHttpError(error) ? error.status : undefined;
			logger.warn({ status: status ?? "internal" }, "[slack] Side question failed");
			await this.tell(
				event.channel,
				event.user,
				"ML Intern could not answer that side question. The run is unaffected; try again shortly.",
				thread.threadTs
			);
		} finally {
			this.sideQuestionAskers.delete(event.user);
		}
		return true;
	}

	/**
	 * a minute of quota in messageEvents, rows are inserted before counting so racing requests
	 * can both back off but never both take the last slot
	 */
	private async reserveSideQuestion(teamId: string, user: string): Promise<boolean> {
		const now = new Date();
		const expiresAt = new Date(now.getTime() + 60_000);
		const rows = [
			{ userId: `slack-btw:${teamId}:${user}`, limit: SLACK_SIDE_QUESTIONS_PER_MINUTE },
			{ userId: `slack-btw:${teamId}`, limit: SLACK_WORKSPACE_SIDE_QUESTIONS_PER_MINUTE },
		].map((row) => ({ ...row, _id: new ObjectId() }));
		await collections.messageEvents.insertMany(
			rows.map(({ _id, userId }) => ({ _id, type: "message", userId, createdAt: now, expiresAt }))
		);
		const counts = await Promise.all(
			rows.map(({ userId }) =>
				collections.messageEvents.countDocuments({
					userId,
					type: "message",
					expiresAt: { $gt: now },
				})
			)
		);
		if (rows.every((row, i) => counts[i] <= row.limit)) return true;
		await collections.messageEvents.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
		return false;
	}

	/**
	 * Personal sessions take only the owner's messages: they run on the owner's HF account, so
	 * other people's text and files would be a prompt-injection path. The owner can paste them in.
	 */
	private async context(
		thread: SlackThread,
		input: { text: string; user: string; ts: string }
	): Promise<{ text: string; files: File[] }> {
		let cursor: string | undefined;
		let omitted = false;
		const messages: ThreadMessage[] = [];
		do {
			const page = await this.app.client.conversations.replies({
				channel: thread.channel,
				ts: thread.threadTs,
				latest: input.ts,
				oldest: thread.contextThroughTs,
				inclusive: true,
				limit: 100,
				cursor,
			});
			messages.push(
				...(page.messages ?? []).filter(
					(m) =>
						(!thread.hfUserId || m.user === thread.owner) &&
						m.user !== this.botUserId &&
						!m.bot_id &&
						!(m.ts && thread.sideQuestionTs?.includes(m.ts)) &&
						(!thread.contextThroughTs || !m.ts || m.ts > thread.contextThroughTs)
				)
			);
			if (messages.length > 200) {
				messages.splice(0, messages.length - 200);
				omitted = true;
			}
			cursor = page.response_metadata?.next_cursor || undefined;
		} while (cursor);
		const text = threadPrompt(
			messages,
			input,
			this.botUserId,
			omitted,
			thread.owner,
			!!thread.hfUserId
		);
		try {
			const files = await downloadAttachments(
				messages,
				input.ts,
				this.botUserId,
				this.settings.botToken
			);
			return { text, files };
		} catch (error) {
			await this.tell(
				thread.channel,
				input.user,
				error instanceof Error ? error.message : "Could not read Slack attachments.",
				thread.threadTs
			);
			throw error;
		}
	}

	private async dispatch(thread: SlackThread, queueOnly = false): Promise<void> {
		const claim = await collections.slackInputs.findOneAndUpdate(
			{
				threadId: thread._id,
				status: "queued",
				...(queueOnly ? { retry: { $ne: true }, resumeElicitationId: { $exists: false } } : {}),
			},
			{ $set: { status: "running", updatedAt: new Date() } },
			{ sort: { ts: 1 }, returnDocument: "after" }
		);
		const input = claim;
		if (!input) return;
		if (!queueOnly) this.runningConversations.set(thread._id, thread.conversationId.toHexString());
		try {
			if (thread.hfUserId && input.user !== thread.owner)
				throw new Error("Only the personal session owner may submit requests.");
			if (!(await this.participant(thread, input.user)))
				throw new Error("The invoking user is no longer eligible in this channel.");
			if (this.stopped) throw new Error("Slack worker stopped.");
			const locals = thread.hfUserId ? await connectedLocals(thread) : undefined;
			const user = locals?.user ?? this.user;
			if (!user) throw new Error("Slack session owner is unavailable.");
			await ensureConversation(thread, user, this.settings);
			const noteMcpUnavailable = () =>
				this.tell(thread.channel, thread.owner, MCP_RESYNC_NOTE, thread.threadTs);
			if (input.resumeElicitationId) {
				const question = await collections.mcpElicitations.findOne({
					conversationId: thread.conversationId,
					elicitationId: input.resumeElicitationId,
				});
				if (question?.pending?.kind === "ask")
					await kickAnsweredAsk(thread.conversationId, input.resumeElicitationId);
				else
					await runSlackTurn(
						thread,
						user,
						{ resumeElicitationId: input.resumeElicitationId },
						locals,
						noteMcpUnavailable
					);
			} else {
				const conv = await collections.conversations.findOne({ _id: thread.conversationId });
				const latest = conv?.messages[conv.messages.length - 1];
				if (
					input.retry &&
					(latest?.id !== input.expectedMessageId ||
						latest?.generationId !== input.expectedGenerationId)
				)
					throw new Error("This resume refers to an older turn.");
				const live =
					latest?.from === "assistant"
						? await isTurnAlive(thread.conversationId, latest.id)
						: undefined;
				const busy = live?.alive;
				// The existing dispatch owns turn startup and question continuation. A concurrent
				// intake may only queue text, never start a second generation or skip its ask.
				if (queueOnly && (!busy || live?.status === "awaiting_input")) {
					await collections.slackInputs.updateOne(
						{ _id: input._id },
						{
							$set: { status: "queued", updatedAt: new Date() },
						}
					);
					return;
				}
				const skipped =
					!queueOnly &&
					latest &&
					busy &&
					!input.retry &&
					input.user === thread.owner &&
					(await skipSlackQuestion(thread, user, latest.id, input._id));
				if (busy && !skipped && !input.retry && input.user === thread.owner) {
					await this.queueIntoTurn(thread, input, user);
				} else if (busy && !skipped) {
					await this.tell(
						thread.channel,
						input.user,
						"ML Intern is still working or waiting for the task owner. The owner can answer its form, send a new request to skip a pending question, or stop the current run.",
						thread.threadTs
					);
				} else {
					if (skipped) await this.render(thread);
					const context = input.retry ? undefined : await this.context(thread, input);
					await runSlackTurn(
						thread,
						user,
						{ ...context, retry: input.retry },
						locals,
						noteMcpUnavailable
					);
					if (!input.retry)
						await collections.slackThreads.updateOne(
							{ _id: thread._id },
							{ $max: { contextThroughTs: input.ts } }
						);
				}
			}
			await collections.slackInputs.updateOne(
				{ _id: input._id },
				{ $set: { status: "done", updatedAt: new Date() } }
			);
		} catch (error) {
			if (error instanceof ConnectionError) {
				const link = await this.reconnectionLink(thread).catch(() => undefined);
				await this.tell(
					thread.channel,
					thread.owner,
					link
						? `<${link}|Reconnect the original Hugging Face account> to continue. Then mention me again.`
						: "Use your recent connection link to reconnect the original Hugging Face account, then mention me again.",
					input.ts === thread.threadTs ? undefined : thread.threadTs
				);
			}
			const status = isHttpError(error) ? error.status : undefined;
			logger.warn({ status: status ?? "internal" }, "[slack] Request failed");
			await collections.slackInputs.updateOne(
				{ _id: input._id },
				{
					$set: {
						status: "failed",
						error:
							status === 429
								? "ML Intern reached a rate limit. Wait before trying again. The workspace shares request limits."
								: status === 409
									? "ML Intern started working on this conversation just before your message arrived. Send it again to queue it for its next step."
									: status
										? `ML Intern rejected this request (HTTP ${status}). Check permissions, request length, and model configuration.`
										: "The bot could not complete this request. Check bot configuration. Retry regenerates the request and may repeat compute; inspect existing jobs first.",
						updatedAt: new Date(),
					},
				}
			);
		} finally {
			if (!queueOnly) {
				this.runningConversations.delete(thread._id);
				// A tick that rendered just before the turn ended would otherwise unwatch the thread
				// and never post the result. The new updatedAt voids that tick's conditional unwatch.
				await collections.slackThreads
					.updateOne({ _id: thread._id }, { $set: { watching: true, updatedAt: new Date() } })
					.catch(() => logger.warn("[slack] Could not rewatch a finished thread"));
			}
		}
	}

	/** the owner message joins the busy turn at its next step or starts the next one */
	private async queueIntoTurn(
		thread: SlackThread,
		input: { text: string; user: string; ts: string },
		owner: User
	): Promise<void> {
		const { text, files } = await this.context(thread, input);
		try {
			await queueForTurn({
				conversationId: thread.conversationId,
				text,
				source: "slack",
				userId: owner._id,
				...(thread.hfUserId ? { sessionId: linkedSessionId(thread) } : {}),
			});
		} catch (error) {
			if (!(error instanceof QueueFullError || error instanceof QueuedInputTooLongError))
				throw error;
			await this.tell(
				thread.channel,
				input.user,
				error instanceof QueueFullError
					? "ML Intern already has 10 messages waiting for its next step. Send this once it catches up."
					: "This message, with the thread around it, is too long to queue. Send it once ML Intern finishes.",
				thread.threadTs
			);
			return;
		}
		await collections.slackThreads.updateOne(
			{ _id: thread._id },
			{ $max: { contextThroughTs: input.ts }, $set: { watching: true, updatedAt: new Date() } }
		);
		await wakeParkForQueuedInput(thread.conversationId);
		kickQueuedTurn(thread.conversationId);
		await this.tell(
			thread.channel,
			input.user,
			files.length > 0
				? "Queued: ML Intern will read this at its next step. Attachments are not passed to a running task; send them again once it finishes."
				: "Queued: ML Intern will read this at its next step.",
			thread.threadTs
		);
	}

	/** Serialize click-driven and background updates so old renders cannot overwrite new choices. */
	private async render(thread: SlackThread): Promise<void> {
		const previous = this.renders.get(thread._id) ?? Promise.resolve();
		const next = previous
			.catch(() => {})
			.then(async () => {
				await this.publishSkippedQuestions(thread);
				await this.publishAnswers(thread);
				await this.publish(thread);
			});
		this.renders.set(thread._id, next);
		try {
			await next;
		} finally {
			if (this.renders.get(thread._id) === next) this.renders.delete(thread._id);
		}
	}
	private async publish(thread: SlackThread): Promise<void> {
		const conv = await collections.conversations.findOne(
			{ _id: thread.conversationId },
			{ projection: { messages: { $slice: -1 }, mlBudget: 1 } }
		);
		const message = conv?.messages[conv.messages.length - 1];
		if (!conv || message?.from !== "assistant") return;
		const state = await collections.turnStates.findOne({
			conversationId: conv._id,
			messageId: message.id,
		});
		if (!state) return;
		if (
			await collections.mcpElicitations.findOne({
				conversationId: conv._id,
				"pending.messageId": message.id,
				slackSkippedByInputId: { $exists: true },
			})
		) {
			await this.publishSessionStatus(thread, "↪️ Continued with a new message", []);
			return;
		}
		const live = await isTurnAlive(conv._id, message.id);
		const question = await collections.mcpElicitations.findOne({
			conversationId: conv._id,
			status: "pending",
			$or: [{ "pending.messageId": message.id }, { generationId: message.generationId }],
		});
		const answered = await collections.mcpElicitations
			.find({
				conversationId: conv._id,
				"pending.messageId": message.id,
				"pending.kind": "ask",
				status: "resolved",
				action: "accept",
				slackShareAnswer: true,
			})
			.sort({ createdAt: -1, _id: -1 })
			.limit(1)
			.next();
		const previousQuestion = answered
			? await collections.slackDeliveries.findOne({
					threadId: thread._id,
					questionId: answered.elicitationId,
				})
			: null;
		const baseline = previousQuestion?.questionSnapshot ?? "";
		const phaseContent =
			baseline && message.content.startsWith(baseline)
				? message.content.slice(baseline.length)
				: message.content;
		const actions: Array<{ id: string; label: string; value: string }> = [];
		const turnValue = JSON.stringify({
			threadId: thread._id,
			messageId: message.id,
			generationId: message.generationId,
		});
		let text: string;
		// a review has no form here, the modal would submit an empty answer and resolve it
		if (question?.pending?.kind === "review") {
			text = `Review waiting, open it on the web: ${conversationLink(conv._id)}`;
		} else if (question) {
			const structured = question.pending?.kind === "ask" && !!question.request.fields?.length;
			text = structured ? "" : question.request.message;
			if (question.request.mode === "form") {
				const label = structured ? questionFormLabel(question.request) : "Answer questions";
				if (label)
					actions.push({
						id: ANSWER_ACTION,
						label,
						value: JSON.stringify({ threadId: thread._id, elicitationId: question.elicitationId }),
					});
			} else text += `\n\nOpen this link to continue: ${question.request.url ?? ""}`;
		} else if (live.alive) {
			text = "";
		} else {
			text =
				visibleText(phaseContent) ||
				(state.status === "failed"
					? runFailureText(message.updates)
					: "The run ended without a text response.");
			if (message.interrupted || state.status === "failed")
				actions.push({ id: RESUME_ACTION, label: "Retry", value: turnValue });
			actions.push({ id: "ml_intern_trace", label: "Download trace", value: thread._id });
		}
		const original = message.queuedContinuationOf
			? await collections.conversations.findOne(
					{ _id: conv._id },
					{
						projection: { messages: { $elemMatch: { id: message.queuedContinuationOf } } },
					}
				)
			: undefined;
		const startedAt = original?.messages[0]?.createdAt ?? message.createdAt ?? state.createdAt;
		const elapsed = Math.max(
			0,
			Math.floor(
				((live.alive ? Date.now() : new Date(state.updatedAt).getTime()) -
					new Date(startedAt).getTime()) /
					this.statusIntervalMs
			) *
				(this.statusIntervalMs / 1000)
		);
		const duration = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
		const status = question
			? question.pending?.kind === "review"
				? "⏳ Waiting for your review"
				: "⏳ Waiting for your answer"
			: live.alive
				? `⏳ _working..._ · ${duration}`
				: message.interrupted
					? "⏹️ Stopped"
					: state.status === "failed"
						? "⚠️ Run failed"
						: `✅ Finished · ${duration}`;
		await this.publishSessionStatus(
			thread,
			status,
			live.alive
				? [{ id: STOP_ACTION, label: "Stop assistant", value: turnValue }]
				: actions.filter((a) => a.id === RESUME_ACTION)
		);
		text = text.trim() || "Waiting for your answer.";
		const digest = createHash("sha256")
			.update(
				JSON.stringify({
					text,
					actions,
					question: question?.request,
					questionLayout: 3,
					choices: question?.slackChoices,
					revision: question?.slackChoiceRevision,
				})
			)
			.digest("hex");
		// An answer may resolve while a refresh is reading state. Never publish its continuation before its answer summary.
		if (
			answered &&
			!(await collections.slackDeliveries.findOne({
				_id: `${thread._id}:answer:${answered.elicitationId}`,
			}))
		)
			return;
		// A resolved question and its continuation share a harness message ID, but must not share a Slack post.
		if (answered && !question && message.generationId === answered.generationId) return;
		const phaseId = `${thread._id}:${message.id}${answered ? `:after:${answered.elicitationId}` : ""}`;
		// Flush public commentary before posting a question. Resumed turns share a harness message,
		// so only prose after the question's saved boundary belongs below its answer.
		if (question || live.alive) {
			await this.publishPublicUpdates(thread, `${phaseId}:updates`, message.id, phaseContent);
			const links = createdSpaceLinks(message.updates);
			if (links.length)
				await this.publishPublicUpdates(
					thread,
					`${thread._id}:${message.id}:spaces`,
					message.id,
					`Spaces created (setup may still be in progress):\n${links.join("\n")}`
				);
		}
		if (live.alive && !question) return;
		const existingQuestion = question
			? await collections.slackDeliveries.findOne({
					threadId: thread._id,
					questionId: question.elicitationId,
				})
			: null;
		const _id = question
			? (existingQuestion?._id ?? `${phaseId}:question:${question.elicitationId}`)
			: live.alive
				? phaseId
				: `${phaseId}:result`;
		let delivery = await collections.slackDeliveries.findOne({ _id });
		if (
			delivery &&
			question?.pending?.kind === "ask" &&
			(delivery.questionId !== question.elicitationId || delivery.questionSnapshot === undefined)
		) {
			await collections.slackDeliveries.updateOne(
				{ _id },
				{ $set: { questionId: question.elicitationId, questionSnapshot: message.content } }
			);
		}
		if (delivery?.digest !== digest) {
			if (!delivery) {
				delivery = {
					_id,
					threadId: thread._id,
					messageId: message.id,
					questionId: question?.pending?.kind === "ask" ? question.elicitationId : undefined,
					questionSnapshot: question ? message.content : undefined,
					parts: [],
					updatedAt: new Date(),
				};
				await collections.slackDeliveries.insertOne(delivery);
			}
			const parts = chunks(text);
			for (let index = 0; index < Math.max(parts.length, delivery.parts.length); index++) {
				const part = parts[index] ?? "(continued above)";
				const blocks =
					question?.pending?.kind === "ask" && index === 0
						? [
								...questionBlocks(
									question.request,
									thread._id,
									question.slackChoices,
									question.slackChoiceRevision
								),
								...messageBlocks(part, actions).filter((block) => block.type === "actions"),
							]
						: messageBlocks(part, index === parts.length - 1 ? actions : []);
				const ts = delivery.parts[index];
				if (ts)
					await this.app.client.chat.update({
						channel: thread.channel,
						ts,
						text: part,
						blocks,
						parse: "none",
					});
				else {
					const sent = await this.app.client.chat.postMessage({
						channel: thread.channel,
						thread_ts: thread.threadTs,
						text: part,
						blocks,
						parse: "none",
						unfurl_links: false,
						unfurl_media: false,
					});
					if (!sent.ts) throw new Error("Slack did not return a message timestamp.");
					delivery.parts.push(sent.ts);
					await collections.slackDeliveries.updateOne(
						{ _id },
						{ $set: { parts: delivery.parts, updatedAt: new Date() } }
					);
				}
			}
			await collections.slackDeliveries.updateOne(
				{ _id },
				{
					$set: {
						digest,
						updatedAt: new Date(),
						...(question?.pending?.kind === "ask"
							? { questionId: question.elicitationId, questionSnapshot: message.content }
							: {}),
					},
				}
			);
		}
		if (
			!live.alive &&
			!this.active.has(thread._id) &&
			!(await hasQueuedInputs(thread.conversationId)) &&
			!(await collections.slackInputs.countDocuments(
				{
					threadId: thread._id,
					$or: [{ status: "queued" }, { status: "failed", failureNotified: { $ne: true } }],
				},
				{ limit: 1 }
			))
		) {
			await collections.slackThreads.updateOne(
				{ _id: thread._id, updatedAt: thread.updatedAt },
				{ $set: { watching: false } }
			);
		}
	}

	private async publishSessionStatus(
		thread: SlackThread,
		status: string,
		actions: Array<{ id: string; label: string; value: string }>
	): Promise<void> {
		const conv = await collections.conversations.findOne(
			{ _id: thread.conversationId },
			{
				projection: {
					"messages.id": 1,
					"messages.from": 1,
					"messages.queuedContinuationOf": 1,
					mlBudget: 1,
				},
			}
		);
		const message = conv?.messages.at(-1);
		if (message?.from !== "assistant") return;
		// Steering may drain into a new assistant turn, but still belongs to the original card.
		const _id = `${thread._id}:status:${message.queuedContinuationOf ?? message.id}`;
		const delivery = await collections.slackDeliveries.findOne({ _id });
		const budget = conv?.mlBudget;
		const text = `**Session status**\n\n${status}\n💻 Jobs ${formatMicroUsd(budget?.spentMicroUsd ?? 0)} spent · ${formatMicroUsd(budget ? reservedMicroUsd(budget) : 0)} reserved · ${formatMicroUsd(budget?.totalMicroUsd ?? 0)} budget`;
		const viewUrl = chatLink(thread) ?? viewerLink(thread.conversationId.toHexString());
		const owner =
			viewUrl && thread.hfUserId
				? await collections.users.findOne({ _id: thread.hfUserId }, { projection: { username: 1 } })
				: undefined;
		const buttons = [
			...messageBlocks("", actions).flatMap((block) =>
				block.type === "actions" ? block.elements : []
			),
			...(viewUrl
				? [
						{
							type: "button" as const,
							action_id: "ml_intern_view",
							text: {
								type: "plain_text" as const,
								text: thread.hfUserId
									? `Open in HuggingChat (${owner?.username || "owner only"})`.slice(0, 75)
									: "Open session",
							},
							url: viewUrl,
						},
					]
				: []),
		];
		const digest = createHash("sha256").update(JSON.stringify({ text, buttons })).digest("hex");
		if (delivery?.digest === digest) return;
		const payload = {
			channel: thread.channel,
			text,
			blocks: [
				...messageBlocks(text, []),
				...(buttons.length ? [{ type: "actions" as const, elements: buttons }] : []),
				{ type: "divider" as const },
			],
			parse: "none" as const,
		};
		let ts = delivery?.parts[0];
		if (ts) await this.app.client.chat.update({ ...payload, ts });
		else {
			const sent = await this.app.client.chat.postMessage({
				...payload,
				thread_ts: thread.threadTs,
				unfurl_links: false,
				unfurl_media: false,
			});
			if (!sent.ts) throw new Error("Slack did not return a message timestamp.");
			ts = sent.ts;
		}
		await collections.slackDeliveries.updateOne(
			{ _id },
			{
				$set: {
					threadId: thread._id,
					messageId: message.id,
					parts: [ts],
					digest,
					updatedAt: new Date(),
				},
			},
			{ upsert: true }
		);
	}

	private async publishPublicUpdates(
		thread: SlackThread,
		_id: string,
		messageId: string,
		content: string
	): Promise<void> {
		let delivery = await collections.slackDeliveries.findOne({ _id });
		const retained = retainPublicUpdates(
			delivery?.publicText ?? "",
			delivery?.publicSnapshot ?? "",
			content
		);
		if (!retained.text || retained.text === delivery?.publicText) return;
		if (!delivery) {
			delivery = { _id, threadId: thread._id, messageId, parts: [], updatedAt: new Date() };
			await collections.slackDeliveries.insertOne(delivery);
		}
		const parts = chunks(`**Run updates**\n\n${retained.text}`);
		const previous = delivery.publicText ? chunks(`**Run updates**\n\n${delivery.publicText}`) : [];
		for (let index = 0; index < parts.length; index++) {
			const text = parts[index];
			if (text === previous[index] && delivery.parts[index]) continue;
			const payload = {
				channel: thread.channel,
				text,
				blocks: messageBlocks(text, []),
				parse: "none" as const,
			};
			const ts = delivery.parts[index];
			if (ts) await this.app.client.chat.update({ ...payload, ts });
			else {
				const sent = await this.app.client.chat.postMessage({
					...payload,
					thread_ts: thread.threadTs,
					unfurl_links: false,
					unfurl_media: false,
				});
				if (!sent.ts) throw new Error("Slack did not return a message timestamp.");
				delivery.parts.push(sent.ts);
				await collections.slackDeliveries.updateOne(
					{ _id },
					{ $set: { parts: delivery.parts, updatedAt: new Date() } }
				);
			}
		}
		await collections.slackDeliveries.updateOne(
			{ _id },
			{
				$set: {
					publicText: retained.text,
					publicSnapshot: retained.snapshot,
					updatedAt: new Date(),
				},
			}
		);
	}

	private async publishSkippedQuestions(thread: SlackThread): Promise<void> {
		const questions = await collections.mcpElicitations
			.find({ conversationId: thread.conversationId, slackSkippedByInputId: { $exists: true } })
			.toArray();
		for (const question of questions) {
			const card = await collections.slackDeliveries.findOne({
				threadId: thread._id,
				questionId: question.elicitationId,
			});
			if (!card || card.questionFinalized) continue;
			const text = "Question skipped — continued with a new message.";
			const blocks = [
				{ type: "section" as const, text: { type: "plain_text" as const, text } },
				...confirmedQuestionBlocks(question.request),
			];
			for (const ts of card.parts)
				await this.app.client.chat.update({
					channel: thread.channel,
					ts,
					text,
					blocks: blocks.slice(0, 49),
					parse: "none",
				});
			await collections.slackDeliveries.updateOne(
				{ _id: card._id },
				{ $set: { questionFinalized: true } }
			);
		}
	}

	private async publishAnswers(thread: SlackThread): Promise<void> {
		const questions = await collections.mcpElicitations
			.find({
				conversationId: thread.conversationId,
				status: "resolved",
				action: "accept",
				resolution: "user",
				slackShareAnswer: true,
				"pending.kind": "ask",
			})
			.toArray();
		for (const question of questions) {
			if (!question.content) continue;
			const _id = `${thread._id}:answer:${question.elicitationId}`;
			const delivery = await collections.slackDeliveries.findOne({ _id });
			if (delivery) continue;
			const card = await collections.slackDeliveries.findOne({
				threadId: thread._id,
				questionId: question.elicitationId,
			});
			const blocks = [
				{
					type: "section" as const,
					text: { type: "mrkdwn" as const, text: `*Answers confirmed by <@${thread.owner}>*` },
				},
				{ type: "divider" as const },
				...confirmedQuestionBlocks(question.request, question.content),
			];
			const parts = [...(card?.parts ?? [])];
			for (let index = 0; index < Math.max(Math.ceil(blocks.length / 45), parts.length); index++) {
				const payload = {
					channel: thread.channel,
					text: "Questions answered. Selected answers are marked ✅.",
					blocks: blocks.slice(index * 45, (index + 1) * 45),
					parse: "none" as const,
				};
				if (parts[index]) await this.app.client.chat.update({ ...payload, ts: parts[index] });
				else {
					const sent = await this.app.client.chat.postMessage({
						...payload,
						thread_ts: thread.threadTs,
						unfurl_links: false,
						unfurl_media: false,
					});
					if (!sent.ts) throw new Error("Slack did not return a message timestamp");
					parts.push(sent.ts);
					if (card)
						await collections.slackDeliveries.updateOne({ _id: card._id }, { $set: { parts } });
				}
			}
			if (card)
				await collections.slackDeliveries.updateOne(
					{ _id: card._id },
					{ $set: { questionFinalized: true } }
				);
			// This durable marker gates continuation until the original card has been updated.
			await collections.slackDeliveries.insertOne({
				_id,
				threadId: thread._id,
				messageId: question.elicitationId,
				parts,
				updatedAt: new Date(),
			});
		}
	}

	private async deliveryFailure(thread: SlackThread): Promise<void> {
		const row = await collections.slackThreads.findOneAndUpdate(
			{ _id: thread._id },
			{ $inc: { renderFailures: 1 } },
			{ returnDocument: "after" }
		);
		const failures = row?.renderFailures ?? 1;
		await collections.slackThreads.updateOne(
			{ _id: thread._id },
			{
				$set: {
					nextRenderAt: new Date(Date.now() + Math.min(300000, 3000 * 2 ** failures)),
					...(failures >= 5 ? { watching: false } : {}),
				},
			}
		);
		logger.warn({ failures }, "[slack] Delivery failed; backing off (paused after five failures)");
	}

	async tick(): Promise<void> {
		if (this.ticking || this.stopped) return;
		this.ticking = true;
		try {
			const threads = await collections.slackThreads
				.find({ teamId: this.settings.teamId, watching: true })
				.sort({ pollAt: 1 })
				.limit(200)
				.toArray();
			this.statusIntervalMs = Math.max(10000, threads.length * 2000);
			for (const thread of threads) {
				let deliveryFailed = false;
				if (!thread.nextRenderAt || thread.nextRenderAt <= new Date()) {
					try {
						await this.render(thread);
					} catch {
						deliveryFailed = true;
						await this.deliveryFailure(thread);
					}
				} else deliveryFailed = true;
				// Intake stays serialized by tick, independently of the long-lived run.
				if (this.active.has(thread._id)) await this.dispatch(thread, true);
				if (
					!this.active.has(thread._id) &&
					this.active.size < 4 &&
					(await collections.slackInputs.countDocuments(
						{ threadId: thread._id, status: "queued" },
						{ limit: 1 }
					))
				) {
					const run = this.dispatch(thread)
						.catch(() => logger.error("[slack] Dispatch failed"))
						.finally(() => this.active.delete(thread._id));
					this.active.set(thread._id, run);
				}
				const failures = await collections.slackInputs
					.find({ threadId: thread._id, status: "failed", failureNotified: { $ne: true } })
					.limit(5)
					.toArray();
				for (const failure of failures) {
					try {
						await this.app.client.chat.postMessage({
							channel: thread.channel,
							thread_ts: thread.threadTs,
							text:
								failure.error ??
								"The request was interrupted. Retry regenerates the request and may repeat compute; inspect existing jobs first.",
						});
						await collections.slackInputs.updateOne(
							{ _id: failure._id },
							{ $set: { failureNotified: true } }
						);
					} catch {
						deliveryFailed = true;
						await this.deliveryFailure(thread);
					}
				}
				await collections.slackThreads.updateOne(
					{ _id: thread._id },
					{ $set: { pollAt: new Date(), ...(!deliveryFailed ? { renderFailures: 0 } : {}) } }
				);
				if (
					!deliveryFailed &&
					!this.active.has(thread._id) &&
					!(await collections.slackInputs.countDocuments(
						{
							threadId: thread._id,
							$or: [
								{ status: { $in: ["queued", "running"] } },
								{ status: "failed", failureNotified: { $ne: true } },
							],
						},
						{ limit: 1 }
					))
				) {
					const latest = await collections.conversations.findOne(
						{ _id: thread.conversationId },
						{ projection: { messages: { $slice: -1 } } }
					);
					const message = latest?.messages.at(-1);
					if (
						(!message || !(await isTurnAlive(thread.conversationId, message.id)).alive) &&
						!(await hasQueuedInputs(thread.conversationId))
					)
						await collections.slackThreads.updateOne(
							{ _id: thread._id, updatedAt: thread.updatedAt },
							{ $set: { watching: false } }
						);
				}
			}
		} finally {
			this.ticking = false;
		}
	}

	async start(): Promise<void> {
		const auth = await this.app.client.auth.test();
		if (auth.team_id !== this.settings.teamId || !auth.user_id)
			throw new Error("Slack bot token belongs to a different workspace.");
		this.botUserId = auth.user_id;
		await collections.slackInputs.createIndex({ threadId: 1, status: 1, ts: 1 });
		await collections.slackThreads.createIndex({ teamId: 1, watching: 1, pollAt: 1 });
		await collections.slackDeliveries.createIndex({ threadId: 1, questionId: 1 });
		// A previous worker may have submitted compute before it died. Never replay an uncertain dispatch.
		const threads = await collections.slackThreads
			.find({ teamId: this.settings.teamId })
			.project<{ _id: string }>({ _id: 1 })
			.toArray();
		await collections.slackInputs.updateMany(
			{ threadId: { $in: threads.map((t) => t._id) }, status: "running" },
			{
				$set: {
					status: "failed",
					error:
						"Worker restarted. Retry regenerates the request and may repeat compute; inspect existing jobs first.",
					updatedAt: new Date(),
				},
			}
		);
		await this.app.start();
		logger.info("[slack] ML Intern connected via Socket Mode");
		this.timer = setInterval(() => {
			void this.tick().catch(() => logger.error("[slack] Worker tick failed"));
		}, 3000);
		this.timer.unref?.();
	}
	async stop(): Promise<void> {
		this.stopped = true;
		clearInterval(this.timer);
		for (const id of this.runningConversations.values()) AbortRegistry.getInstance().abort(id);
		await this.app.stop();
	}
}

export async function startSlackBot(): Promise<void> {
	try {
		await startConfiguredSlackBot();
	} catch {
		logger.error(
			"[slack] Disabled: invalid configuration. Check Slack account mode, OAuth origins and required settings."
		);
	}
}
async function startConfiguredSlackBot(): Promise<void> {
	const settings = slackConfig();
	if (!settings) return;
	for await (const thread of collections.slackThreads.find({ deletedAt: { $exists: false } })) {
		await collections.conversations.updateOne(
			{ _id: thread.conversationId, managedBy: { $exists: false } },
			{
				$set: {
					managedBy: {
						kind: "slack",
						continueUrl: `https://app.slack.com/client/${thread.teamId}/${thread.channel}/thread/${thread.channel}-${thread.threadTs}`,
					},
				},
			}
		);
	}
	if (
		!ML_ASSISTANT_MODE ||
		config.USE_USER_TOKEN !== "true" ||
		config.MCP_FORWARD_HF_USER_TOKEN !== "true"
	)
		throw new Error(
			"Slack ML needs ML_ASSISTANT_MODE, USE_USER_TOKEN and MCP_FORWARD_HF_USER_TOKEN enabled."
		);
	if (settings.accountMode === "user") {
		const { loginEnabled } = await import("$lib/server/auth");
		if (!loginEnabled) throw new Error("User-account Slack mode requires HuggingChat OAuth login.");
		if (viewerConfig()?.origin !== chatOrigin()) {
			const missing = (
				[
					"SLACK_ML_VIEWER_ORIGIN",
					"SLACK_ML_VIEWER_CLIENT_ID",
					"SLACK_ML_VIEWER_CLIENT_SECRET",
					"SLACK_ML_VIEWER_SESSION_SECRET",
				] as const
			).filter((key) => !config[key]);
			throw new Error(
				"Personal Slack sessions require Slack OIDC configured on PUBLIC_ORIGIN to verify account ownership. " +
					(missing.length
						? `Missing: ${missing.join(", ")}.`
						: "Check origin equality and that the session signing secret has at least 32 characters.")
			);
		}
		if (pinnedHubToken())
			throw new Error("User-account Slack mode cannot use a pinned Hub MCP token.");
	}
	if (pinnedHubToken() && pinnedHubToken() !== settings.hfToken)
		throw new Error("Slack ML cannot share a deployment with a different pinned Hub MCP token.");

	const leader = new SlackLeader(settings.teamId);
	let bot: MlSlackBot | undefined;
	let ticking = false;
	const acquire = async () => {
		if (ticking) return;
		ticking = true;
		try {
			const held = await leader.acquire();
			if (!held && bot) {
				await bot.stop();
				bot = undefined;
			}
			if (held && !bot) {
				const user = settings.hfToken ? await provisionSlackIdentity(settings) : undefined;
				const candidate = new MlSlackBot(settings, user);
				try {
					await candidate.start();
					bot = candidate;
				} catch {
					await candidate.stop();
					throw new Error("Slack startup failed");
				}
			}
		} catch {
			if (bot && !leader.isValid()) {
				await bot.stop();
				bot = undefined;
			}
			logger.error("[slack] Connection or leader renewal failed");
		} finally {
			ticking = false;
		}
	};
	await acquire();
	const timer = setInterval(() => {
		void acquire();
	}, 10_000);
	timer.unref?.();
	const expiryTimer = setInterval(() => {
		if (bot && !leader.isValid()) {
			const expired = bot;
			bot = undefined;
			void expired.stop().catch(() => logger.error("[slack] Expired lease shutdown failed"));
		}
	}, 1000);
	expiryTimer.unref?.();
	onExit(async () => {
		clearInterval(expiryTimer);
		clearInterval(timer);
		await bot?.stop();
		await leader.release();
	});
}
