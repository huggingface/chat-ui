import { base } from "$app/paths";
import superjson from "superjson";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { MlFileRef } from "$lib/types/MlFile";
import type {
	ReviewAnswer,
	ReviewArea,
	ReviewComment,
	ReviewDestination,
	ReviewDraft,
	ReviewPublish,
	ReviewQuote,
	ReviewTime,
	ReviewRecord,
	ReviewSchema,
	ReviewStatus,
} from "$lib/types/MlReview";
import { blockers, recordStatus, type ReviewBlocker } from "$lib/utils/review/answers";
import { draftStatus, imageUrl, mergeDraft, type DeliveryStatus } from "$lib/utils/review/view";
import { REVIEW_LIMITS } from "$lib/utils/review/schema";
import {
	isDecided,
	passFailQuestion,
	recordState,
	type RecordDecision,
	type RecordState,
} from "$lib/utils/review/progress";
import { mcpSelection } from "$lib/utils/sendElicitationAnswer";
import { safeInvalidate } from "$lib/utils/safeInvalidate";
import { UrlDependency } from "$lib/types/UrlDependency";

export const REVIEW_SAVE_DEBOUNCE_MS = 250;
/** a queued submission is posted within about 10 s of the running turn ending */
export const REVIEW_DELIVERY_POLL_MS = 2_000;
/** fast for the first half minute, then slower, each poll reads the whole review */
const DELIVERY_FAST_POLLS = 15;
const DELIVERY_SLOW_POLL_MS = 10_000;
const DELIVERY_POLL_LIMIT = 90;
/** a running push polls fast for its first minute, then slowly, each poll reads the whole review */
const PUSH_POLL_MS = 3_000;
const PUSH_FAST_POLLS = 20;
const PUSH_WAIT_POLL_MS = 15_000;
/** about half an hour, a push still running then has lost its replica and nothing will end it */
const PUSH_POLL_LIMIT = 130;

const tabHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

type FetchFn = typeof globalThis.fetch;

export interface ReviewPayload {
	id: string;
	schema: ReviewSchema;
	schemaHash: string;
	records: ReviewRecord[];
	drafts: Record<string, ReviewDraft>;
	status: ReviewStatus;
	/** the user's free text sent with the submission */
	note?: string;
	result?: { text: string; files: MlFileRef[] };
	/** the server posts a submission the turn had moved past as the user's next message */
	delivery?: { status: DeliveryStatus; messageId?: string };
	/** where the labels go, pushed after the submit by the resume or the delivery */
	destination?: ReviewDestination;
	/** the destination the user chose not to push to, kept after the submit */
	declinedDestination?: ReviewDestination;
	/** the publish card that confirms the push after a submit, and its answer */
	publish?: ReviewPublish;
	push?: ReviewPushState;
	createdAt: Date;
	updatedAt: Date;
}

/** what the status endpoint answers, everything a poll needs and no records or drafts */
interface ReviewStatusPayload {
	id: string;
	status: ReviewStatus;
	result?: { files: MlFileRef[]; pushed?: { url: string; pr: boolean; path: string } };
	destination?: ReviewDestination;
	declinedDestination?: ReviewDestination;
	publish?: ReviewPublish;
	push?: ReviewPushState;
	delivery?: ReviewPayload["delivery"];
	updatedAt: Date;
}

export interface ReviewPushState {
	status: "pushing" | "pushed" | "failed";
	url?: string;
	path?: string;
	pr?: boolean;
	error?: string;
}

export type ReviewLoad = "loading" | "ready" | "missing" | "error";

export type ReviewView = "focus" | "list" | "table" | "grid";

export interface ReviewCounts {
	answered: number;
	skipped: number;
	comments: number;
}

export interface CommentInput {
	field?: string;
	quote?: ReviewQuote;
	area?: ReviewArea;
	time?: ReviewTime;
	body: string;
}

const UNREACHABLE = "Could not reach the server. Try again.";
/** saves that keep losing to another tab stop retrying and show the conflict */
const MAX_CONFLICT_RETRIES = 3;

const messageOf = (body: unknown, fallback: string): string =>
	typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
		? body.message
		: fallback;

/** the draft conflict answers in superjson, every other error in plain JSON */
function parseBody(text: string): unknown {
	try {
		const raw = JSON.parse(text);
		return raw && typeof raw === "object" && "json" in raw ? superjson.parse(text) : raw;
	} catch {
		return null;
	}
}

const emptyDraft = (): ReviewDraft => ({
	status: "pending",
	answers: {},
	comments: [],
	updatedAt: new Date(),
});

/** saves per record, debounced, one request in flight, the newest draft wins */
export class ReviewSession {
	readonly conversationId: string;
	readonly reviewId: string;

	load = $state<ReviewLoad>("loading");
	payload = $state.raw<ReviewPayload | undefined>(undefined);
	drafts = $state<Record<string, ReviewDraft>>({});
	/** by record position, why its last save failed */
	saveErrors = new SvelteMap<number, string>();
	saving = $state(0);
	note = $state("");
	submitting = $state(false);
	submitError = $state<string | undefined>(undefined);
	/** the blockers a refused submit answered with */
	serverBlockers = $state.raw<ReviewBlocker[]>([]);

	/** pane state, kept here so a closed and reopened pane lands where the user was */
	view = $state<ReviewView | undefined>(undefined);
	/** undefined until the pane picks one, a fresh label review opens on its start step */
	screen = $state<"start" | "work" | "finish" | undefined>(undefined);
	navigatorOpen = $state(false);
	focus = $state(0);
	expanded = new SvelteSet<number>();
	/** undefined until the user toggles it, the pane then opens it for a short review only */
	instructionsOpen = $state<boolean | undefined>(undefined);

	schema = $derived(this.payload?.schema);
	/** a record answered but short of a required answer is still to do, as the server counts it */
	states = $derived<RecordState[]>(
		(this.payload?.records ?? []).map((_, index) => {
			const draft = this.drafts[String(index)];
			const schema = this.payload?.schema;
			return recordState(schema && draft ? { status: recordStatus(schema, draft) } : draft);
		})
	);
	records = $derived(this.payload?.records ?? []);
	editable = $derived(
		this.load === "ready" &&
			(this.payload?.status === "open" || this.payload?.status === "detached")
	);
	blockers = $derived(
		this.payload ? blockers(this.payload.schema, this.drafts, this.payload.records.length) : []
	);
	/** an answer given but not valid, the only thing that still stops a send */
	invalidBlockers = $derived(this.blockers.filter((blocker) => blocker.reason !== "required"));
	/** records the agent gets as not reviewed, sending them is allowed after a confirm */
	unfinished = $derived(this.states.filter((state) => state === "todo").length);
	counts = $derived.by((): ReviewCounts => {
		const counts = { answered: 0, skipped: 0, comments: 0 };
		for (const draft of Object.values(this.drafts)) {
			if (draft.status === "answered") counts.answered += 1;
			if (draft.status === "skipped" || draft.status === "discarded") counts.skipped += 1;
			counts.comments += draft.comments.length;
		}
		return counts;
	});
	/** records approved, rejected or answered, a submit needs at least one */
	decided = $derived(Object.values(this.drafts).filter(isDecided).length);
	/** label mode, some question is required on every record */
	labelling = $derived(
		this.payload?.schema.questions.some((question) => question.required) ?? false
	);

	#timers = new Map<number, ReturnType<typeof setTimeout>>();
	#inflight = new Map<number, Promise<void>>();
	#again = new Set<number>();
	/** a queued resave keeps the keepalive of any call that asked for it, a hiding tab must not lose it */
	#againKeepalive = new Set<number>();
	/** by record position, the server revision the local copy builds on, 0 before the first save */
	#revisions = new Map<number, number>();
	#conflicts = new Map<number, number>();
	/** the server copy each record's revision names, a conflict merges only what changed since */
	#base = new Map<number, Pick<ReviewDraft, "status" | "answers" | "comments">>();
	readonly #owner: MlReviewsStore;
	readonly #epoch: number;

	constructor(owner: MlReviewsStore, conversationId: string, reviewId: string, epoch: number) {
		this.#owner = owner;
		this.conversationId = conversationId;
		this.reviewId = reviewId;
		this.#epoch = epoch;
	}

	get #url() {
		return `${base}/api/v2/conversations/${this.conversationId}/reviews/${encodeURIComponent(this.reviewId)}`;
	}

	/** false once the store moved to another conversation, a late answer then lands nowhere */
	get #alive() {
		return this.#owner.epoch === this.#epoch;
	}

	draft(index: number): ReviewDraft | undefined {
		return this.drafts[String(index)];
	}

	/** a detached review's publish card goes onto its message only once no turn is saving it */
	get publishWaiting(): boolean {
		const publish = this.payload?.publish;
		return (
			!!this.payload?.delivery && !!publish?.promptId && !publish.decision && !publish.attached
		);
	}

	/** a turn end brings the push result */
	get pushPending(): boolean {
		const payload = this.payload;
		return (
			payload?.status === "submitted" &&
			!!payload.destination &&
			payload.push?.status !== "pushed" &&
			payload.push?.status !== "failed"
		);
	}

	/** a field with no stored value streams through the media route, which re-signs viewer links */
	mediaSrc(index: number, field: string): string | undefined {
		const record = this.payload?.records[index];
		if (!record) return undefined;
		if (record.media?.includes(field)) {
			return `${this.#url}/media/${index}/${encodeURIComponent(field)}`;
		}
		const value = record.values[field];
		return typeof value === "string" ? imageUrl(value) : undefined;
	}

	async refresh(): Promise<void> {
		try {
			const res = await this.#owner.fetcher(this.#url, { headers: { Accept: "application/json" } });
			if (!this.#alive) return;
			if (res.status === 404) {
				this.load = "missing";
				return;
			}
			if (!res.ok) {
				if (!this.payload) this.load = "error";
				return;
			}
			const payload = superjson.parse<ReviewPayload>(await res.text());
			if (!this.#alive) return;
			const drafts: Record<string, ReviewDraft> = { ...payload.drafts };
			const dirty = new Set([
				...this.#timers.keys(),
				...this.#inflight.keys(),
				...this.saveErrors.keys(),
			]);
			for (const [key, draft] of Object.entries(payload.drafts)) {
				if (dirty.has(Number(key))) continue;
				this.#revisions.set(Number(key), draft.revision ?? 0);
				this.#base.set(Number(key), draft);
			}
			// an edit still waiting to be saved is newer than what the server holds
			for (const index of dirty) {
				const local = this.drafts[String(index)];
				if (local) drafts[String(index)] = local;
			}
			this.drafts = drafts;
			this.payload = payload;
			if (payload.note !== undefined) this.note = payload.note;
			this.load = "ready";
			this.#watchPush();
		} catch {
			if (this.#alive && !this.payload) this.load = "error";
		}
	}

	/** the push and delivery state only, a submitted review's records and drafts no longer change */
	async refreshStatus(): Promise<void> {
		const current = this.payload;
		if (!current) return this.refresh();
		try {
			const res = await this.#owner.fetcher(`${this.#url}/status`, {
				headers: { Accept: "application/json" },
			});
			if (!this.#alive || !res.ok) return;
			const next = superjson.parse<ReviewStatusPayload>(await res.text());
			if (!this.#alive) return;
			const { destination, declinedDestination, publish, push, delivery } = next;
			const attachedNow = !!publish?.attached && !current.publish?.attached;
			this.payload = {
				...current,
				status: next.status,
				destination,
				declinedDestination,
				publish,
				push,
				delivery,
				result: next.result
					? { text: current.result?.text ?? "", ...current.result, ...next.result }
					: current.result,
			};
			// the card renders from the conversation, so it shows once that is read again
			if (attachedNow) void this.#owner.followConversation();
			this.#watchPush();
		} catch {
			// a missed poll is retried by the next one
		}
	}

	setAnswer(index: number, question: string, value: ReviewAnswer | undefined): void {
		const schema = this.schema;
		if (!schema || !this.editable) return;
		const current = this.draft(index) ?? emptyDraft();
		const answers = { ...current.answers };
		if (value === undefined) delete answers[question];
		else answers[question] = value;
		this.#update(index, {
			...current,
			answers,
			status: draftStatus(schema, answers, current.status, { answering: true }),
		});
	}

	/** a yes/no question carries the decision when the review has one, otherwise the status does */
	decide(indices: Iterable<number>, decision: RecordDecision | undefined): void {
		const schema = this.schema;
		if (!schema || !this.editable) return;
		const question = schema.questions.length > 0 ? passFailQuestion(schema) : undefined;
		for (const index of indices) {
			if (question) {
				this.setAnswer(index, question.name, decision && decision === "approved");
				continue;
			}
			const current = this.draft(index) ?? emptyDraft();
			this.#update(index, {
				...current,
				status: !decision ? "pending" : decision === "approved" ? "answered" : "discarded",
			});
		}
	}

	skip(index: number): void {
		if (!this.editable) return;
		const current = this.draft(index) ?? emptyDraft();
		this.#update(index, { ...current, status: "skipped" });
	}

	addComment(index: number, input: CommentInput): ReviewComment | undefined {
		if (!this.editable) return undefined;
		const current = this.draft(index) ?? emptyDraft();
		const comment: ReviewComment = {
			id: globalThis.crypto.randomUUID(),
			...(input.field !== undefined ? { field: input.field } : {}),
			...(input.quote ? { quote: input.quote } : {}),
			...(input.area ? { area: input.area } : {}),
			...(input.time ? { time: input.time } : {}),
			body: input.body.trim(),
			createdAt: new Date(),
		};
		this.#update(index, { ...current, comments: [...current.comments, comment] });
		return comment;
	}

	/** comments the whole review and each record can still take */
	commentRoom(indices: Iterable<number>): string | undefined {
		const list = [...indices];
		const left = REVIEW_LIMITS.comments - this.counts.comments;
		if (list.length > left) {
			return `A review holds at most ${REVIEW_LIMITS.comments} comments, ${Math.max(left, 0)} left. Select fewer.`;
		}
		const full = list.find(
			(index) => (this.draft(index)?.comments.length ?? 0) >= REVIEW_LIMITS.commentsPerRecord
		);
		return full === undefined
			? undefined
			: `#${full + 1} already has ${REVIEW_LIMITS.commentsPerRecord} comments, the most one record holds.`;
	}

	/**
	 * one write for a grid selection, a decision or the same comment on every record, the
	 * server applies it all or nothing, so the local copy rolls back when it refuses
	 */
	async bulk(
		indices: Iterable<number>,
		change: { decision: RecordDecision } | { comment: CommentInput }
	): Promise<string | undefined> {
		const schema = this.schema;
		const list = [...new Set(indices)].sort((a, b) => a - b);
		if (!schema || !this.editable || list.length === 0) return undefined;
		if ("comment" in change) {
			const room = this.commentRoom(list);
			if (room) return room;
		}
		await this.flush();
		if (!this.#alive) return undefined;

		const question = schema.questions.length > 0 ? passFailQuestion(schema) : undefined;
		const id = globalThis.crypto.randomUUID();
		const before = new Map(list.map((index) => [index, this.draft(index)]));
		let body: Record<string, unknown>;
		if ("decision" in change) {
			const ok = change.decision === "approved";
			body = question
				? { answers: { [question.name]: ok } }
				: { status: ok ? "answered" : "discarded" };
		} else {
			const { field, area, time } = change.comment;
			body = {
				addComment: {
					id,
					...(field !== undefined ? { field } : {}),
					...(area ? { area } : {}),
					...(time ? { time } : {}),
					body: change.comment.body.trim(),
				},
			};
		}

		for (const index of list) {
			const current = this.draft(index) ?? emptyDraft();
			let next: ReviewDraft;
			if ("decision" in change && question) {
				const answers = { ...current.answers, [question.name]: change.decision === "approved" };
				next = {
					...current,
					answers,
					status: draftStatus(schema, answers, current.status, { answering: true }),
				};
			} else if ("decision" in change) {
				next = { ...current, status: change.decision === "approved" ? "answered" : "discarded" };
			} else {
				const { field, area, time } = change.comment;
				next = {
					...current,
					comments: [
						...current.comments,
						{
							id: `${id}-${index}`,
							...(field !== undefined ? { field } : {}),
							...(area ? { area } : {}),
							...(time ? { time } : {}),
							body: change.comment.body.trim(),
							createdAt: new Date(),
						},
					],
				};
			}
			this.drafts[String(index)] = { ...next, updatedAt: new Date() };
		}

		const rollback = () => {
			for (const [index, draft] of before) {
				if (draft) this.drafts[String(index)] = draft;
				else delete this.drafts[String(index)];
			}
		};
		this.saving += 1;
		try {
			const res = await this.#owner.fetcher(this.#url, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({ bulk: { indexes: list, ...body } }),
			});
			const parsed = parseBody(await res.text().catch(() => ""));
			if (!this.#alive) return undefined;
			if (!res.ok) {
				rollback();
				if (res.status === 409) void this.refresh();
				return messageOf(parsed, "Could not save the selection.");
			}
			const revisions =
				parsed && typeof parsed === "object" && "revisions" in parsed
					? (parsed.revisions as Record<string, number>)
					: {};
			for (const index of list) {
				const revision = revisions[String(index)];
				if (typeof revision === "number") this.#revisions.set(index, revision);
				const draft = this.draft(index);
				if (draft) this.#base.set(index, draft);
				this.saveErrors.delete(index);
			}
			return undefined;
		} catch {
			if (!this.#alive) return undefined;
			rollback();
			return UNREACHABLE;
		} finally {
			this.saving -= 1;
		}
	}

	removeComment(index: number, id: string): void {
		const current = this.draft(index);
		if (!current || !this.editable) return;
		this.#update(index, {
			...current,
			comments: current.comments.filter((comment) => comment.id !== id),
		});
	}

	#update(index: number, next: ReviewDraft) {
		this.drafts[String(index)] = { ...next, updatedAt: new Date() };
		const timer = this.#timers.get(index);
		if (timer) clearTimeout(timer);
		this.#timers.set(
			index,
			setTimeout(() => void this.#save(index), REVIEW_SAVE_DEBOUNCE_MS)
		);
	}

	retrySaves(): Promise<void> {
		return Promise.all([...this.saveErrors.keys()].map((index) => this.#save(index))).then(
			() => undefined
		);
	}

	openRecord(index: number): void {
		this.focus = Math.max(0, Math.min(index, this.records.length - 1));
		this.screen = "work";
		this.navigatorOpen = false;
	}

	/** keepalive lets the requests outlive a closing tab */
	async flush({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
		const waiting = [...this.#timers.keys()].map((index) => this.#save(index, keepalive));
		await Promise.all([...waiting, ...this.#inflight.values()]);
	}

	#save(index: number, keepalive = false): Promise<void> {
		const timer = this.#timers.get(index);
		if (timer) clearTimeout(timer);
		this.#timers.delete(index);
		const running = this.#inflight.get(index);
		if (running) {
			this.#again.add(index);
			if (keepalive) this.#againKeepalive.add(index);
			return running;
		}
		const request = (async () => {
			try {
				await this.#send(index, keepalive);
			} finally {
				this.#inflight.delete(index);
			}
			// the edit made while the last one was in flight, sent even after a conversation switch
			if (this.#again.delete(index)) {
				const queuedKeepalive = this.#againKeepalive.delete(index);
				await this.#save(index, keepalive || queuedKeepalive);
			}
		})();
		this.#inflight.set(index, request);
		return request;
	}

	async #send(index: number, keepalive: boolean): Promise<void> {
		const draft = this.draft(index);
		if (!draft) return;
		const sent = {
			status: draft.status,
			answers: $state.snapshot(draft.answers),
			comments: $state.snapshot(draft.comments),
		};
		const body = JSON.stringify({
			index,
			draft: sent,
			baseRevision: this.#revisions.get(index) ?? 0,
		});
		this.saving += 1;
		try {
			const res = await this.#owner.fetcher(this.#url, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body,
				keepalive,
			});
			// a save still running after a conversation switch keeps its revision and retries
			if (res.ok) {
				const saved = await res.json().catch(() => null);
				if (typeof saved?.revision === "number") this.#revisions.set(index, saved.revision);
				this.#base.set(index, sent);
				this.#conflicts.delete(index);
				this.saveErrors.delete(index);
				return;
			}
			const parsed = parseBody(await res.text().catch(() => ""));
			if (res.status === 409 && typeof parsed === "object" && parsed && "draft" in parsed) {
				this.#adoptConflict(index, parsed.draft as ReviewDraft | undefined, parsed);
				return;
			}
			if (!this.#alive) return;
			this.saveErrors.set(index, messageOf(parsed, "This draft did not save."));
			// submitted from another tab or expired, show what the server holds
			if (res.status === 409) void this.refresh();
		} catch {
			if (this.#alive) this.saveErrors.set(index, UNREACHABLE);
		} finally {
			this.saving -= 1;
		}
	}

	/**
	 * another tab saved this record first, only what this tab changed since its base copy lands on
	 * top of theirs, then the merge is saved again on their revision
	 */
	#adoptConflict(index: number, theirs: ReviewDraft | undefined, body: unknown) {
		const tries = (this.#conflicts.get(index) ?? 0) + 1;
		this.#conflicts.set(index, tries);
		if (tries > MAX_CONFLICT_RETRIES) {
			if (this.#alive) {
				this.saveErrors.set(index, messageOf(body, "This record keeps changing in another tab."));
			}
			return;
		}
		this.#revisions.set(index, theirs?.revision ?? 0);
		const ours = this.draft(index);
		if (theirs && ours && this.schema) {
			this.drafts[String(index)] = {
				...mergeDraft(this.schema, this.#base.get(index), ours, theirs),
				updatedAt: new Date(),
			};
		}
		if (theirs) this.#base.set(index, theirs);
		this.#again.add(index);
	}

	#pushTimer: ReturnType<typeof setTimeout> | undefined;
	#pushPolls = 0;
	/** polling gave up on a push still marked running, the pane says it could not confirm it */
	pushStale = $state(false);

	/** any load of a review whose push has not landed keeps reading it until the push ends */
	#watchPush(): void {
		if (!this.pushPending) {
			this.#pushPolls = 0;
			this.pushStale = false;
		}
		if (!this.#alive || !this.pushPending || this.#pushTimer) return;
		// the publish card waits on the user, the answer resumes the turn and its end refreshes this,
		// one not yet on its message is read slowly until the sweep puts it there
		const publish = this.payload?.publish;
		if (publish?.promptId && !publish.decision && !this.publishWaiting) return;
		const running = this.payload?.push?.status === "pushing";
		if (this.#pushPolls >= PUSH_POLL_LIMIT) {
			this.pushStale = running;
			return;
		}
		const wait = running && this.#pushPolls < PUSH_FAST_POLLS ? PUSH_POLL_MS : PUSH_WAIT_POLL_MS;
		this.#pushTimer = setTimeout(() => {
			this.#pushTimer = undefined;
			if (!this.#alive) return;
			// a hidden tab waits without fetching, and reads it again once it is shown
			if (typeof document !== "undefined" && document.visibilityState === "hidden") {
				this.#watchPush();
				return;
			}
			this.#pushPolls += 1;
			void this.refreshStatus();
		}, wait);
	}

	/** a turn end may have started the push, so the poll budget starts over */
	rewatchPush(): void {
		this.#pushPolls = 0;
		this.pushStale = false;
		void this.refreshStatus();
	}

	/** the posted message and its run reach the page once the conversation reloads */
	#followDelivery(attempt = 0) {
		const wait = attempt < DELIVERY_FAST_POLLS ? REVIEW_DELIVERY_POLL_MS : DELIVERY_SLOW_POLL_MS;
		setTimeout(async () => {
			if (!this.#alive) return;
			// a hidden tab waits without fetching, the posted message reaches it once it is shown
			if (tabHidden()) return this.#followDelivery(attempt);
			await this.refreshStatus();
			const status = this.payload?.delivery?.status;
			if (status === "sent") void this.#owner.followConversation();
			else if (status !== "failed" && attempt + 1 < DELIVERY_POLL_LIMIT) {
				this.#followDelivery(attempt + 1);
			}
		}, wait);
	}

	/** `approveRest` has the server mark every undecided record OK, one write instead of one per record */
	async submit({ approveRest = false }: { approveRest?: boolean } = {}): Promise<boolean> {
		if (this.submitting || !this.editable) return false;
		this.submitting = true;
		this.submitError = undefined;
		this.serverBlockers = [];
		try {
			await this.flush();
			if (!this.#alive) return false;
			if (this.saveErrors.size > 0) {
				this.submitError = "Some drafts did not save, so the review was not submitted.";
				return false;
			}
			const selection = await mcpSelection();
			const note = this.note.trim();
			const res = await this.#owner.fetcher(`${this.#url}/submit`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({
					...(note ? { note } : {}),
					...(approveRest ? { approveRest: true } : {}),
					selection,
				}),
			});
			const body = await res.json().catch(() => null);
			if (!this.#alive) return false;
			if (!res.ok) {
				this.submitError = messageOf(body, "Could not submit the review.");
				if (res.status === 400 && Array.isArray(body?.blockers))
					this.serverBlockers = body.blockers;
				if (res.status === 409) void this.refresh();
				return false;
			}
			await this.refresh();
			if (body?.delivery === "sent") void this.#owner.followConversation();
			else if (body?.delivery === "queued") this.#followDelivery();
			return true;
		} catch {
			if (this.#alive) this.submitError = UNREACHABLE;
			return false;
		} finally {
			this.submitting = false;
		}
	}
}

/** the reviews of the open conversation, a review is loaded when its card or pane first needs it */
export class MlReviewsStore {
	conversationId = $state<string | undefined>(undefined);
	/** bumped by every reset, a session from before one is dead */
	epoch = 0;
	#sessions = new SvelteMap<string, ReviewSession>();
	#disposers: (() => void)[] = [];
	readonly #fetcher: FetchFn | undefined;

	/** the fetch is injectable so a spec never opens a socket */
	constructor(fetcher?: FetchFn) {
		this.#fetcher = fetcher;
	}

	get fetcher(): FetchFn {
		return this.#fetcher ?? globalThis.fetch;
	}

	get(reviewId: string | null | undefined): ReviewSession | undefined {
		return reviewId ? this.#sessions.get(reviewId) : undefined;
	}

	ensure(conversationId: string, reviewId: string): ReviewSession {
		this.bind(conversationId);
		const existing = this.#sessions.get(reviewId);
		if (existing) return existing;
		// created under the card effect, the session deriveds would freeze when the card remounts
		let session: ReviewSession | undefined;
		this.#disposers.push(
			$effect.root(() => {
				session = new ReviewSession(this, conversationId, reviewId, this.epoch);
			})
		);
		if (!session) throw new Error("review session was not created");
		this.#sessions.set(reviewId, session);
		void session.refresh();
		return session;
	}

	bind(conversationId: string | undefined): void {
		if (this.conversationId === conversationId) return;
		this.reset();
		this.conversationId = conversationId;
	}

	/** a turn end can detach or expire an open review or push a submitted one */
	refreshOpen(): void {
		for (const session of this.#sessions.values()) {
			if (session.payload?.status === "open") void session.refresh();
			else if (session.pushPending) session.rewatchPush();
		}
	}

	flushAll(options?: { keepalive?: boolean }): Promise<void> {
		return Promise.all([...this.#sessions.values()].map((session) => session.flush(options))).then(
			() => undefined
		);
	}

	reset(): void {
		void this.flushAll({ keepalive: true });
		this.epoch += 1;
		this.#sessions.clear();
		for (const dispose of this.#disposers.splice(0)) dispose();
		this.conversationId = undefined;
	}

	/** reloads the open conversation so a message the server posted, and its run, show up */
	async followConversation(): Promise<void> {
		await safeInvalidate(UrlDependency.Conversation);
	}
}

export const mlReviews = new MlReviewsStore();
