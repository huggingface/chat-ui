import { base } from "$app/paths";
import superjson from "superjson";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { MlFileRef } from "$lib/types/MlFile";
import type {
	ReviewAnswer,
	ReviewArea,
	ReviewComment,
	ReviewDraft,
	ReviewQuote,
	ReviewTime,
	ReviewRecord,
	ReviewSchema,
	ReviewStatus,
	ReviewVerdict,
} from "$lib/types/MlReview";
import { blockers, type ReviewBlocker } from "$lib/utils/review/answers";
import { draftStatus, mergeDraft } from "$lib/utils/review/view";
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
const DELIVERY_POLL_LIMIT = 90;

type FetchFn = typeof globalThis.fetch;

export interface ReviewPayload {
	id: string;
	schema: ReviewSchema;
	schemaHash: string;
	records: ReviewRecord[];
	drafts: Record<string, ReviewDraft>;
	status: ReviewStatus;
	verdict?: ReviewVerdict;
	summary?: string;
	result?: { text: string; files: MlFileRef[] };
	/** the server posts a submission the turn had moved past as the user's next message */
	delivery?: { status: "pending" | "sending" | "sent" | "failed"; messageId?: string };
	createdAt: Date;
	updatedAt: Date;
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
export const NOTHING_DECIDED = "Approve, reject or answer at least one record before sending.";
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
	verdict = $state<ReviewVerdict | undefined>(undefined);
	summary = $state("");
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
	states = $derived<RecordState[]>(
		(this.payload?.records ?? []).map((_, index) => recordState(this.drafts[String(index)]))
	);
	records = $derived(this.payload?.records ?? []);
	editable = $derived(
		this.load === "ready" &&
			(this.payload?.status === "open" || this.payload?.status === "detached")
	);
	blockers = $derived(
		this.payload ? blockers(this.payload.schema, this.drafts, this.payload.records.length) : []
	);
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
	chosenVerdict = $derived<ReviewVerdict>(
		this.verdict ?? (this.labelling || this.counts.comments === 0 ? "approve" : "comment")
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
			if (payload.verdict) this.verdict = payload.verdict;
			if (payload.summary !== undefined) this.summary = payload.summary;
			this.load = "ready";
		} catch {
			if (this.#alive && !this.payload) this.load = "error";
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

	/** the posted message and its run reach the page once the conversation reloads */
	#followDelivery(attempt = 0) {
		setTimeout(async () => {
			if (!this.#alive) return;
			await this.refresh();
			const status = this.payload?.delivery?.status;
			if (status === "sent") void this.#owner.followConversation();
			else if (status !== "failed" && attempt + 1 < DELIVERY_POLL_LIMIT) {
				this.#followDelivery(attempt + 1);
			}
		}, REVIEW_DELIVERY_POLL_MS);
	}

	/** `approveRest` has the server approve every undecided record, one write instead of one per record */
	async submit(
		verdict: ReviewVerdict,
		{ approveRest = false }: { approveRest?: boolean } = {}
	): Promise<boolean> {
		if (this.submitting || !this.editable) return false;
		if (!approveRest && this.decided === 0) {
			this.submitError = NOTHING_DECIDED;
			return false;
		}
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
			const summary = this.summary.trim();
			const res = await this.#owner.fetcher(`${this.#url}/submit`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({
					verdict,
					...(summary ? { summary } : {}),
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
			this.verdict = verdict;
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

	/** a turn that ended may have detached or expired a review this tab still shows as open */
	refreshOpen(): void {
		for (const session of this.#sessions.values()) {
			if (session.payload?.status === "open") void session.refresh();
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
