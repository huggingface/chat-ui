import { AbortRegistry } from "$lib/server/abortRegistry";
import { createHash } from "node:crypto";
import { App } from "@slack/bolt";
import { z } from "zod";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { onExit } from "$lib/server/exitHandler";
import { logger } from "$lib/server/logger";
import { ML_ASSISTANT_MODE } from "$lib/utils/mlAssistantFlag";
import { pinnedHubToken } from "$lib/server/mlAssistant";
import { isTurnAlive } from "$lib/server/generation/turnLog";
import { kickAnsweredAsk } from "$lib/server/generation/askResume";
import { submitElicitationAnswer } from "$lib/server/mcp/elicitation";
import { reservedMicroUsd, formatMicroUsd } from "$lib/utils/mlBudget";
import type { User } from "$lib/types/User";
import { slackConfig, type SlackConfig } from "./config";
import { provisionSlackIdentity } from "./identity";
import { ensureConversation, runSlackTurn, stopSlackTurn } from "./engine";
import { isWorkspaceMember, threadPrompt, type ThreadMessage } from "./context";
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
	answerSummary,
	activityText,
	ANSWER_ACTION,
	ANSWER_VIEW,
	STOP_ACTION,
	RESUME_ACTION,
	chunks,
	messageBlocks,
	questionModal,
	readAnswers,
	visibleText,
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
	text: z.string().max(40_000),
	ts: z.string().regex(/^\d+\.\d+$/),
	thread_ts: z
		.string()
		.regex(/^\d+\.\d+$/)
		.optional(),
	bot_id: z.string().optional(),
	subtype: z.string().optional(),
});

/** Transport and delivery only. ML Intern's existing engine owns tool execution and resume. */
export class MlSlackBot {
	readonly app: App;
	private botUserId = "";
	private active = new Map<string, Promise<void>>();
	private runningConversations = new Map<string, string>();
	private members = new Map<string, { allowed: boolean; until: number }>();
	private ticking = false;
	private renders = new Map<string, Promise<void>>();
	private timer?: ReturnType<typeof setInterval>;
	private stopped = false;
	constructor(
		readonly settings: SlackConfig,
		readonly user: User
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

	private async member(userId: string): Promise<boolean> {
		const cached = this.members.get(userId);
		if (cached && cached.until > Date.now()) return cached.allowed;
		const result = await this.app.client.users.info({ user: userId });
		const allowed = !!result.user && isWorkspaceMember(result.user, this.settings.teamId);
		this.members.set(userId, { allowed, until: Date.now() + 60_000 });
		return allowed;
	}

	private async owned(
		threadId: string,
		userId: string,
		teamId: string | undefined
	): Promise<SlackThread | null> {
		if (teamId !== this.settings.teamId || !(await this.member(userId))) return null;
		return collections.slackThreads.findOne({ _id: threadId, teamId, owner: userId });
	}

	private async tell(channel: string, user: string, text: string): Promise<void> {
		await this.app.client.chat.postEphemeral({ channel, user, text });
	}

	private register(): void {
		this.app.event("app_mention", async ({ event, body }) => {
			await this.receive(event, body.team_id, body.event_id);
		});
		this.app.event("message", async ({ event, body }) => {
			if ("channel_type" in event && event.channel_type === "im")
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
			const thread = await this.owned(parsed.data.threadId, body.user.id, body.team?.id);
			if (!thread) return;
			const conv = await collections.conversations.findOne({ _id: thread.conversationId });
			if (conv?.messages.at(-1)?.id !== parsed.data.messageId) return;
			await stopSlackTurn(thread, this.user);
			await this.tell(
				thread.channel,
				body.user.id,
				"Stopped the assistant. Jobs already running on Hugging Face keep running until cancelled or timed out."
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
			if (body.team?.id !== this.settings.teamId || !(await this.member(body.user.id))) return;
			const thread = await collections.slackThreads.findOne({
				_id: action.value ?? "",
				teamId: this.settings.teamId,
			});
			if (!thread || !("channel" in body) || body.channel?.id !== thread.channel) return;
			// DMs remain private to their owner; channel trace buttons are shared.
			if (thread.channel.startsWith("D") && thread.owner !== body.user.id) return;
			if (
				this.settings.allowedChannels.length &&
				!this.settings.allowedChannels.includes(thread.channel)
			)
				return;
			const channel = await this.app.client.conversations.info({ channel: thread.channel });
			if (channel.channel?.is_ext_shared) return;
			const conv = await collections.conversations.findOne({ _id: thread.conversationId });
			if (!conv) return;
			// Uploaded only to the original thread, never a public shared-conversation URL.
			await this.app.client.files.uploadV2({
				channel_id: thread.channel,
				thread_ts: thread.threadTs,
				filename: `ml-intern-${conv._id}.jsonl`,
				content: conv.messages.map((m) => JSON.stringify(m)).join("\n"),
				title: "ML Intern conversation trace",
			});
		});
		this.app.error(async () => {
			logger.error("[slack] Could not handle a Slack event; no credentials or payload logged.");
		});
	}

	async receive(raw: unknown, teamId: string, eventId: string): Promise<void> {
		const parsed = mention.safeParse(raw);
		if (!parsed.success || teamId !== this.settings.teamId) return;
		const event = parsed.data;
		if (event.bot_id || event.subtype || event.user === this.botUserId) return;
		if (
			this.settings.allowedChannels.length &&
			!this.settings.allowedChannels.includes(event.channel)
		)
			return;
		if (!(await this.member(event.user))) return;
		const channel = await this.app.client.conversations.info({ channel: event.channel });
		if (channel.channel?.is_ext_shared) {
			await this.tell(
				event.channel,
				event.user,
				"ML Intern is available in internal workspace channels and DMs."
			);
			return;
		}
		const thread = await getOrCreateThread(
			teamId,
			event.channel,
			event.thread_ts ?? event.ts,
			event.user
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

	private async context(
		thread: SlackThread,
		input: { text: string; user: string; ts: string }
	): Promise<string> {
		let cursor: string | undefined;
		const messages: ThreadMessage[] = [];
		do {
			const page = await this.app.client.conversations.replies({
				channel: thread.channel,
				ts: thread.threadTs,
				latest: input.ts,
				inclusive: true,
				limit: 100,
				cursor,
			});
			messages.push(...(page.messages ?? []));
			cursor = page.response_metadata?.next_cursor || undefined;
		} while (cursor && messages.length < 200);
		return threadPrompt(messages, input, this.botUserId, Boolean(cursor), thread.owner);
	}

	private async dispatch(thread: SlackThread): Promise<void> {
		const claim = await collections.slackInputs.findOneAndUpdate(
			{ threadId: thread._id, status: "queued" },
			{ $set: { status: "running", updatedAt: new Date() } },
			{ sort: { ts: 1 }, returnDocument: "after" }
		);
		const input = claim.value;
		if (!input) return;
		this.runningConversations.set(thread._id, thread.conversationId.toHexString());
		try {
			if (!(await this.member(input.user)))
				throw new Error("The invoking user is no longer a workspace member.");
			if (this.stopped) throw new Error("Slack worker stopped.");
			await ensureConversation(thread, this.user, this.settings);
			if (input.resumeElicitationId) {
				const question = await collections.mcpElicitations.findOne({
					conversationId: thread.conversationId,
					elicitationId: input.resumeElicitationId,
				});
				if (question?.pending?.kind === "ask")
					await kickAnsweredAsk(thread.conversationId, input.resumeElicitationId);
				else
					await runSlackTurn(thread, this.user, { resumeElicitationId: input.resumeElicitationId });
			} else {
				const conv = await collections.conversations.findOne({ _id: thread.conversationId });
				const latest = conv?.messages[conv.messages.length - 1];
				if (
					input.retry &&
					(latest?.id !== input.expectedMessageId ||
						latest?.generationId !== input.expectedGenerationId)
				)
					throw new Error("This resume refers to an older turn.");
				if (
					latest?.from === "assistant" &&
					(await isTurnAlive(thread.conversationId, latest.id)).alive
				) {
					await this.tell(
						thread.channel,
						input.user,
						"ML Intern is still working or waiting for the task owner. The owner can answer its form or stop the current run; mention me again when that turn is finished."
					);
				} else {
					const text = input.retry ? undefined : await this.context(thread, input);
					await runSlackTurn(thread, this.user, { text, retry: input.retry });
				}
			}
			await collections.slackInputs.updateOne(
				{ _id: input._id },
				{ $set: { status: "done", updatedAt: new Date() } }
			);
		} catch {
			await collections.slackInputs.updateOne(
				{ _id: input._id },
				{
					$set: {
						status: "failed",
						error:
							"The bot could not complete this request. Check bot configuration and use Resume or mention it again.",
						updatedAt: new Date(),
					},
				}
			);
		} finally {
			this.runningConversations.delete(thread._id);
		}
	}

	/** Serialize click-driven and background updates so old renders cannot overwrite new choices. */
	private async render(thread: SlackThread): Promise<void> {
		const previous = this.renders.get(thread._id) ?? Promise.resolve();
		const next = previous
			.catch(() => {})
			.then(async () => {
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
		const conv = await collections.conversations.findOne({ _id: thread.conversationId });
		const message = conv?.messages[conv.messages.length - 1];
		if (!conv || message?.from !== "assistant") return;
		const state = await collections.turnStates.findOne({
			conversationId: conv._id,
			messageId: message.id,
		});
		if (!state) return;
		const live = await isTurnAlive(conv._id, message.id);
		const question = await collections.mcpElicitations.findOne({
			conversationId: conv._id,
			status: "pending",
			$or: [{ "pending.messageId": message.id }, { generationId: message.generationId }],
		});
		const actions: Array<{ id: string; label: string; value: string }> = [];
		const turnValue = JSON.stringify({
			threadId: thread._id,
			messageId: message.id,
			generationId: message.generationId,
		});
		let text: string;
		if (question) {
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
			text =
				state.status === "waiting"
					? `Waiting: ${state.waitReason ?? "for compute to finish"}`
					: activityText(
							message.updates,
							await collections.nestedAgentCalls.countDocuments({
								conversationId: conv._id,
								generationId: message.generationId,
								label: "research",
								status: "success",
							})
						);
			const elapsed = Math.max(
				0,
				Math.floor(
					(Date.now() - new Date(message.createdAt ?? state.createdAt).getTime()) / 10000
				) * 10
			);
			text += `\nElapsed: ${elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}`;

			if (state.status === "waiting" && state.waitUntil) {
				const remaining = Math.max(
					0,
					Math.ceil((new Date(state.waitUntil).getTime() - Date.now()) / 30000) * 30
				);
				text += remaining
					? ` · Next check in ~${remaining < 60 ? `${remaining}s` : `${Math.ceil(remaining / 60)}m`}`
					: " · Next check is due";
			}

			const steps = conv.plan?.steps ?? [];
			const current = steps.find((s) => s.status === "in_progress");
			if (steps.length)
				text += `\n\n${steps.filter((s) => s.status === "completed").length}/${steps.length} steps complete${current ? ` · ${current.step.slice(0, 200)}` : ""}`;
			const links = createdSpaceLinks(message.updates);
			if (links.length)
				text += `\n\nSpace created (setup may still be in progress):\n${links.join("\n")}`;
		} else {
			text =
				visibleText(message.content) ||
				(state.status === "failed"
					? "The run failed. You can resume it below."
					: "The run ended without a text response.");
			if (message.interrupted || state.status === "failed")
				actions.push({ id: RESUME_ACTION, label: "Resume", value: turnValue });
			actions.push({ id: "ml_intern_trace", label: "Download trace", value: thread._id });
		}
		if (live.alive) actions.push({ id: STOP_ACTION, label: "Stop assistant", value: turnValue });
		if (conv.mlBudget)
			text += `\n\nCompute: ${formatMicroUsd(conv.mlBudget.spentMicroUsd)} spent · ${formatMicroUsd(reservedMicroUsd(conv.mlBudget))} reserved · ${formatMicroUsd(conv.mlBudget.totalMicroUsd)} budget`;
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
		const _id = `${thread._id}:${message.id}${answered ? `:after:${answered.elicitationId}` : ""}`;
		let delivery = await collections.slackDeliveries.findOne({ _id });
		if (
			delivery &&
			question?.pending?.kind === "ask" &&
			delivery.questionId !== question.elicitationId
		) {
			await collections.slackDeliveries.updateOne(
				{ _id },
				{ $set: { questionId: question.elicitationId } }
			);
		}
		if (delivery?.digest !== digest) {
			if (!delivery) {
				delivery = {
					_id,
					threadId: thread._id,
					messageId: message.id,
					questionId: question?.pending?.kind === "ask" ? question.elicitationId : undefined,
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
								...messageBlocks(part, actions),
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
						...(question?.pending?.kind === "ask" ? { questionId: question.elicitationId } : {}),
					},
				}
			);
		}
		// Keep public prose in a separate, cumulative post so status, questions and final results cannot erase it.
		if (live.alive && !question)
			await this.publishPublicUpdates(thread, `${_id}:updates`, message.id, message.content);
		if (
			!live.alive &&
			!this.active.has(thread._id) &&
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
			// Leave the question card in place, removing only its now-inactive controls.
			const card = await collections.slackDeliveries.findOne({
				threadId: thread._id,
				questionId: question.elicitationId,
			});
			if (card && !card.questionFinalized) {
				const blocks = questionBlocks(
					question.request,
					thread._id,
					question.slackChoices,
					question.slackChoiceRevision
				).filter((b) => b.type !== "actions" && b.type !== "context");
				blocks[0] = {
					type: "section",
					text: {
						type: "plain_text",
						text: "Questions answered. Confirmed answers are posted below.",
					},
				};
				for (const ts of card.parts)
					await this.app.client.chat.update({
						channel: thread.channel,
						ts,
						text: "Questions answered. Confirmed answers are posted below.",
						blocks,
						parse: "none",
					});
				await collections.slackDeliveries.updateOne(
					{ _id: card._id },
					{ $set: { questionFinalized: true } }
				);
			}
			const text = answerSummary(question.request, question.content);
			const parts: string[] = delivery?.parts ?? [];
			const texts = chunks(text);
			for (const part of texts.slice(parts.length)) {
				const sent = await this.app.client.chat.postMessage({
					channel: thread.channel,
					thread_ts: thread.threadTs,
					text: `Answers from <@${thread.owner}>\n${part}`,
					blocks: [
						{
							type: "section",
							text: { type: "mrkdwn", text: `*Answers confirmed by <@${thread.owner}>*` },
						},
						{
							type: "section",
							text: {
								type: "mrkdwn",
								text: part.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
							},
						},
					],
					unfurl_links: false,
					unfurl_media: false,
				});
				if (!sent.ts) throw new Error("Slack did not return a message timestamp");
				parts.push(sent.ts);
				await collections.slackDeliveries.updateOne(
					{ _id },
					{
						$set: {
							threadId: thread._id,
							messageId: question.elicitationId,
							parts,
							updatedAt: new Date(),
						},
					},
					{ upsert: true }
				);
			}
		}
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
			for (const thread of threads) {
				try {
					await this.render(thread);
				} catch {
					logger.warn("[slack] Delivery failed; will retry.");
					continue;
				}
				if (!this.active.has(thread._id) && this.active.size < 4) {
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
								"The request was interrupted. Use Resume or mention me again; existing compute has not been resubmitted.",
						});
						await collections.slackInputs.updateOne(
							{ _id: failure._id },
							{ $set: { failureNotified: true } }
						);
					} catch {
						logger.warn("[slack] Failure notification will retry.");
					}
				}
				await collections.slackThreads.updateOne(
					{ _id: thread._id },
					{ $set: { pollAt: new Date() } }
				);
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
					error: "Worker restarted; use Resume instead of resubmitting compute.",
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
	const settings = slackConfig();
	if (!settings) return;
	if (
		!ML_ASSISTANT_MODE ||
		config.USE_USER_TOKEN !== "true" ||
		config.MCP_FORWARD_HF_USER_TOKEN !== "true"
	)
		throw new Error(
			"Slack ML needs ML_ASSISTANT_MODE, USE_USER_TOKEN and MCP_FORWARD_HF_USER_TOKEN enabled."
		);
	if (pinnedHubToken() && pinnedHubToken() !== settings.hfToken)
		throw new Error("Slack ML cannot share a deployment with a different pinned Hub MCP token.");
	const user = await provisionSlackIdentity(settings);
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
			if (bot) {
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
	onExit(async () => {
		clearInterval(timer);
		await bot?.stop();
		await leader.release();
	});
}
