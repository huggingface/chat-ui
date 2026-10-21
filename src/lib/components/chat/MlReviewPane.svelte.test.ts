import MlReviewPane from "./MlReviewPane.svelte";
import MlReviewCard from "./MlReviewCard.svelte";
import { render } from "vitest-browser-svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import { tick } from "svelte";
import { navigation, setPage } from "$lib/components/__tests__/appMocks";
import { mlReviews, type ReviewPayload } from "$lib/stores/mlReview.svelte";
import { sidePane } from "$lib/stores/sidePane.svelte";
import { MessageReviewUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import type {
	ReviewDraft,
	ReviewRecord,
	ReviewSchema,
	ReviewSuggestionsMode,
} from "$lib/types/MlReview";

const media = vi.hoisted(() => {
	const rate = 8000;
	const bytes = new Uint8Array(44 + rate);
	const view = new DataView(bytes.buffer);
	const text = (at: number, value: string) =>
		[...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
	text(0, "RIFF");
	view.setUint32(4, 36 + rate, true);
	text(8, "WAVEfmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate, true);
	view.setUint16(32, 1, true);
	view.setUint16(34, 8, true);
	text(36, "data");
	view.setUint32(40, rate, true);
	bytes.fill(128, 44);
	return {
		wav: `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`,
		png: `data:image/svg+xml,${encodeURIComponent(
			'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#ccc"/></svg>'
		)}`,
	};
});

/** the test browser has no network, local media stands in for the Hub files */
vi.mock("$lib/utils/review/view", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/utils/review/view")>();
	return {
		...real,
		imageUrl: (uri: string) =>
			uri.endsWith("/local.wav")
				? media.wav
				: uri.endsWith("/local.svg")
					? media.png
					: real.imageUrl(uri),
	};
});

const CONVERSATION = "0123456789abcdef01234567";
const REVIEW = "89abcdef0123456789abcdef";

const labelSchema = (suggestions: ReviewSuggestionsMode = "after_answer"): ReviewSchema => ({
	title: "triage batch 1",
	instructions: "Label each issue.",
	idField: "id",
	fields: [
		{ name: "title", type: "text" },
		{ name: "body", type: "text" },
	],
	questions: [
		{
			name: "kind",
			type: "label",
			required: true,
			options: [{ value: "bug" }, { value: "feature" }, { value: "question" }],
		},
		{ name: "severity", type: "rating", required: false, min: 1, max: 5 },
	],
	suggestions,
});

const RECORDS: ReviewRecord[] = [
	{
		id: "r1",
		values: { title: "Crash on start", body: "The app crashes when I open it on a Pixel." },
		suggestions: { kind: { value: "bug", score: 0.72, rationale: "mentions a crash" } },
	},
	{
		id: "r2",
		values: { title: "Dark mode", body: "Please add a dark theme." },
		suggestions: { kind: { value: "feature" } },
	},
	{ id: "r3", values: { title: "How to export?", body: "Where is the export button?" } },
];

const payload = (overrides: Partial<ReviewPayload> = {}): ReviewPayload => ({
	id: REVIEW,
	schema: labelSchema(),
	schemaHash: "abcd1234",
	records: RECORDS,
	drafts: {},
	status: "open",
	createdAt: new Date(),
	updatedAt: new Date(),
	...overrides,
});

interface Patch {
	index: number;
	draft: Pick<ReviewDraft, "status" | "answers" | "comments">;
	baseRevision?: number;
	keepalive?: boolean;
}

function fakeServer(review: ReviewPayload) {
	const patches: Patch[] = [];
	const submits: unknown[] = [];
	let gate: Promise<void> | undefined;
	let release: (() => void) | undefined;
	let submitAnswer: unknown = { ok: true, files: [] };
	let conflict: ReviewDraft | undefined;
	let onSubmit: (() => void) | undefined;
	const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (method === "GET" && url.endsWith(`/conversations/${CONVERSATION}/reviews/${REVIEW}`)) {
			return new Response(superjson.stringify(review));
		}
		if (method === "PATCH") {
			const patch: Patch = { ...JSON.parse(String(init?.body)), keepalive: init?.keepalive };
			patches.push(patch);
			if (gate) await gate;
			if (conflict) {
				const draft = conflict;
				conflict = undefined;
				return new Response(
					superjson.stringify({ message: "This record was changed elsewhere.", draft }),
					{ status: 409 }
				);
			}
			return Response.json({ ok: true, problems: [], revision: (patch.baseRevision ?? 0) + 1 });
		}
		if (method === "POST" && url.endsWith("/submit")) {
			submits.push(JSON.parse(String(init?.body)));
			onSubmit?.();
			return Response.json(submitAnswer);
		}
		return new Response("{}", { status: 404 });
	});
	vi.stubGlobal("fetch", fetch);
	return {
		patches,
		submits,
		hold() {
			gate = new Promise((resolve) => (release = resolve));
		},
		release() {
			gate = undefined;
			release?.();
		},
		answerSubmit(body: unknown) {
			submitAnswer = body;
		},
		whenSubmitted(fn: () => void) {
			onSubmit = fn;
		},
		conflictOnce(draft: ReviewDraft) {
			conflict = draft;
		},
	};
}

/** the test frame is narrower than a desktop, so the pane would take its phone layout */
function desktop(matches = true) {
	const real = window.matchMedia.bind(window);
	vi.stubGlobal("matchMedia", (query: string) => ({
		...real(query),
		matches,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
}

/** a label review opens on its start step, `work` steps past it to the first record */
async function mount(review: ReviewPayload, { work = true }: { work?: boolean } = {}) {
	const server = fakeServer(review);
	setPage({ params: { id: CONVERSATION } });
	sidePane.openReview(REVIEW);
	const screen = render(MlReviewPane);
	await vi.waitFor(() => expect(mlReviews.get(REVIEW)?.load).toBe("ready"));
	await tick();
	if (work && screen.container.querySelector("[data-start-step]")) {
		document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await tick();
	}
	return { ...screen, server, session: () => mlReviews.get(REVIEW) };
}

const press = async (key: string, target: EventTarget = document.body) => {
	target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
	await tick();
};

const position = (container: HTMLElement) =>
	container.querySelector("[data-focus-position]")?.textContent?.replace(/\s+/g, " ").trim();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const question = (container: HTMLElement, name: string) =>
	container.querySelector<HTMLElement>(`[data-question='${name}']`);

const button = (root: ParentNode, label: string) => {
	const found = [...root.querySelectorAll("button")].find(
		// an option of the question the keys answer carries its key hint first
		(candidate) => candidate.textContent?.trim().replace(/^[1-9]\s*/, "") === label
	);
	if (!found) throw new Error(`no button "${label}"`);
	return found;
};

const at = new Date();

const cardRequest = (
	overrides: Partial<{ mode: "label" | "review"; records: number; questions: number }> = {}
) => ({
	type: MessageUpdateType.Review as const,
	subtype: MessageReviewUpdateType.Request as const,
	reviewId: REVIEW,
	toolUuid: "u1",
	title: "triage batch 1",
	records: 3,
	questions: 2,
	mode: "label" as const,
	...overrides,
});

const reviewSchema: ReviewSchema = {
	title: "sampled rows",
	instructions: "Flag anything off-topic.",
	idField: "id",
	fields: [
		{ name: "prompt", type: "text" },
		{ name: "response", type: "markdown" },
	],
	questions: [],
	suggestions: "shown",
};

describe("MlReviewPane", () => {
	beforeEach(() => desktop());
	afterEach(() => {
		try {
			localStorage.removeItem("mlReviewAutoAdvance");
		} catch {
			// storage is optional
		}
		mlReviews.reset();
		sidePane.reset();
		vi.unstubAllGlobals();
	});

	describe("start step", () => {
		it("opens a fresh label review on its start step, with the instructions and the keys", async () => {
			const { container } = await mount(payload(), { work: false });
			const start = container.querySelector("[data-start-step]") as HTMLElement;
			expect(start.textContent).toContain("Label each issue.");
			expect(start.textContent).toContain("bug, feature, question");
			expect(start.textContent).toContain("1–3");

			await press("Enter");
			expect(container.querySelector("[data-start-step]")).toBeNull();
			expect(position(container)).toBe("1 of 3");
		});

		it("skips the start step once work has begun", async () => {
			const { container } = await mount(
				payload({
					drafts: {
						"0": { status: "answered", answers: { kind: "bug" }, comments: [], updatedAt: at },
					},
				}),
				{ work: false }
			);
			expect(container.querySelector("[data-start-step]")).toBeNull();
		});

		it("keeps the instructions behind the title once working", async () => {
			const { container } = await mount(payload());
			expect(container.querySelector("[role='dialog'][aria-label='Instructions']")).toBeNull();
			(container.querySelector("header button[aria-expanded]") as HTMLButtonElement).click();
			await tick();
			expect(container.querySelector("[aria-label='Instructions']")?.textContent).toContain(
				"Label each issue."
			);
		});
	});

	describe("focus view", () => {
		it("labels from the keyboard", async () => {
			const { container, server, session } = await mount(payload());
			expect(question(container, "kind")?.dataset.active).toBe("true");

			await press("2");
			expect(session()?.draft(0)?.answers.kind).toBe("feature");
			expect(question(container, "severity")?.dataset.active).toBe("true");
			await press("4");
			expect(session()?.draft(0)?.answers).toEqual({ kind: "feature", severity: 4 });
			expect(session()?.draft(0)?.status).toBe("answered");

			await press("ArrowUp");
			expect(question(container, "kind")?.dataset.active).toBe("true");
			await press("ArrowDown");
			expect(question(container, "severity")?.dataset.active).toBe("true");

			await press("j");
			expect(position(container)).toBe("2 of 3");
			await press("1");
			expect(session()?.draft(1)?.answers.kind).toBe("bug");

			await press("k");
			expect(position(container)).toBe("1 of 3");
			await press("Enter");
			expect(position(container)).toBe("3 of 3");

			await press("s");
			expect(session()?.draft(2)?.status).toBe("skipped");

			await press("k");
			await press("c");
			const box = container.querySelector("textarea[aria-label='Comment']");
			expect(box).not.toBeNull();
			await press("3", box as HTMLTextAreaElement);
			expect(session()?.draft(1)?.answers.kind).toBe("bug");

			await vi.waitFor(() =>
				expect(server.patches.find((patch) => patch.index === 0)?.draft).toMatchObject({
					status: "answered",
					answers: { kind: "feature", severity: 4 },
				})
			);
		});

		it("shows the record heading and drops the id field from the fields", async () => {
			const { container } = await mount(
				payload({
					schema: {
						...labelSchema(),
						fields: [{ name: "id", type: "text" }, ...labelSchema().fields],
					},
					records: RECORDS.map((record) => ({
						...record,
						values: { ...record.values, id: record.id },
					})),
				})
			);
			expect(container.querySelector("[data-record-heading]")?.textContent?.trim()).toBe(
				"Crash on start"
			);
			expect(container.querySelector("[data-field='id']")).toBeNull();
		});

		it("opens the comment box once per C, not again on the next record", async () => {
			const { container } = await mount(payload());
			await press("c");
			const box = container.querySelector("textarea[aria-label='Comment']") as HTMLTextAreaElement;
			await press("Escape", box);
			expect(container.querySelector("textarea[aria-label='Comment']")).toBeNull();

			await press("j");
			expect(position(container)).toBe("2 of 3");
			expect(container.querySelector("textarea[aria-label='Comment']")).toBeNull();
		});

		it("jumps to a record from the progress bar", async () => {
			const { container } = await mount(payload());
			const bar = container.querySelector("[data-progress-bar]") as HTMLElement;
			const box = bar.getBoundingClientRect();
			bar.dispatchEvent(
				new MouseEvent("click", { bubbles: true, clientX: box.right - 2, clientY: box.top + 5 })
			);
			await tick();
			expect(position(container)).toBe("3 of 3");

			bar.dispatchEvent(
				new MouseEvent("mousemove", { bubbles: true, clientX: box.left + 2, clientY: box.top + 5 })
			);
			await tick();
			expect(container.querySelector("[role='tooltip']")?.textContent).toContain("#1 · to do");
		});

		it("auto-advances once every pickable question of the record is answered", async () => {
			const { container } = await mount(payload());
			(
				container.querySelector("[data-question-dock] input[type='checkbox']") as HTMLInputElement
			).click();
			await tick();

			await press("1");
			await sleep(400);
			expect(position(container)).toBe("1 of 3");

			await press("3");
			await vi.waitFor(() => expect(position(container)).toBe("2 of 3"));
		});
	});

	describe("autosave", () => {
		it("saves a record once per pause, and at once when the tab is hidden", async () => {
			const { container, server } = await mount(payload());
			const kind = question(container, "kind") as HTMLElement;

			button(kind, "bug").click();
			await tick();
			button(kind, "feature").click();
			await sleep(100);
			expect(server.patches).toHaveLength(0);
			await vi.waitFor(() => expect(server.patches).toHaveLength(1));
			expect(server.patches[0]).toMatchObject({
				index: 0,
				draft: { answers: { kind: "feature" } },
			});

			button(kind, "question").click();
			await tick();
			Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
			try {
				document.dispatchEvent(new Event("visibilitychange"));
				await vi.waitFor(() => expect(server.patches).toHaveLength(2), { timeout: 150 });
			} finally {
				// the own property shadows the prototype getter, removing it restores the real one
				delete (document as { visibilityState?: unknown }).visibilityState;
			}
			expect(server.patches[1]).toMatchObject({
				keepalive: true,
				draft: { answers: { kind: "question" } },
			});
		});

		it("keeps one save in flight per record, and sends the newest draft after it", async () => {
			const { container, server } = await mount(payload());
			const kind = question(container, "kind") as HTMLElement;

			server.hold();
			button(kind, "bug").click();
			await vi.waitFor(() => expect(server.patches).toHaveLength(1));
			button(kind, "feature").click();
			await tick();
			button(kind, "question").click();
			await sleep(400);
			expect(server.patches).toHaveLength(1);

			server.release();
			await vi.waitFor(() => expect(server.patches).toHaveLength(2));
			expect(server.patches[1].draft.answers).toEqual({ kind: "question" });
		});

		it("keeps a draft that failed to save when the review is refreshed", async () => {
			const review = payload();
			const { session, server } = await mount(review);
			const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
				(init?.method ?? "GET") === "PATCH"
					? new Response("{}", { status: 500 })
					: new Response(superjson.stringify(review))
			);
			vi.stubGlobal("fetch", fetch);
			await press("1");
			await vi.waitFor(() => expect(session()?.saveErrors.size).toBe(1));
			await session()?.refresh();
			expect(session()?.draft(0)?.answers.kind).toBe("bug");
			expect(server.patches).toHaveLength(0);
		});

		it("finishes a queued save on the right revision after a conversation switch", async () => {
			const { container, server } = await mount(payload());
			const kind = question(container, "kind") as HTMLElement;
			server.hold();
			button(kind, "bug").click();
			await vi.waitFor(() => expect(server.patches).toHaveLength(1));
			button(kind, "feature").click();
			await tick();
			mlReviews.reset();
			server.release();
			await vi.waitFor(() => expect(server.patches).toHaveLength(2));
			expect(server.patches[1]).toMatchObject({
				baseRevision: 1,
				draft: { answers: { kind: "feature" } },
			});
		});

		it("says why a draft did not save in the header, and retries", async () => {
			const { container } = await mount(payload());
			const limit = "This review's answers have reached the 8 MB limit.";
			const fetch = vi.fn(async () => Response.json({ message: limit }, { status: 413 }));
			vi.stubGlobal("fetch", fetch);
			await press("1");
			await vi.waitFor(() =>
				expect(container.querySelector("[data-save-state='error']")?.textContent).toContain(
					`Not saved: ${limit}`
				)
			);
			const calls = fetch.mock.calls.length;
			button(container, "Retry").click();
			await vi.waitFor(() => expect(fetch.mock.calls.length).toBe(calls + 1));
		});

		it("saves on top of the revision it last saw", async () => {
			const { server } = await mount(
				payload({
					drafts: {
						"0": { status: "pending", answers: {}, comments: [], updatedAt: at, revision: 4 },
					},
				})
			);
			await press("1");
			await vi.waitFor(() => expect(server.patches).toHaveLength(1));
			expect(server.patches[0].baseRevision).toBe(4);

			await press("3");
			await vi.waitFor(() => expect(server.patches).toHaveLength(2));
			expect(server.patches[1].baseRevision).toBe(5);

			await press("j");
			await press("2");
			await vi.waitFor(() => expect(server.patches).toHaveLength(3));
			expect(server.patches[2]).toMatchObject({ index: 1, baseRevision: 0 });
		});

		it("keeps both edits when another tab saved the record first", async () => {
			const { server, session } = await mount(payload());
			server.conflictOnce({
				status: "pending",
				answers: { severity: 2 },
				comments: [{ id: "c-other", body: "from the other tab", createdAt: at }],
				updatedAt: at,
				revision: 7,
			});
			await press("1");
			await vi.waitFor(() => expect(server.patches).toHaveLength(2));
			expect(server.patches[1]).toMatchObject({
				baseRevision: 7,
				draft: { status: "answered", answers: { kind: "bug", severity: 2 } },
			});
			expect(server.patches[1].draft.comments.map((comment) => comment.id)).toEqual(["c-other"]);
			expect(session()?.saveErrors.size).toBe(0);
		});
	});

	describe("comments", () => {
		it("marks a comment whose quote is gone as no longer found", async () => {
			const { container } = await mount(
				payload({
					drafts: {
						"0": {
							status: "pending",
							answers: {},
							updatedAt: at,
							comments: [
								{
									id: "c-found",
									field: "body",
									quote: { exact: "crashes when I open", prefix: "The app ", suffix: " it on" },
									body: "Which version?",
									createdAt: at,
								},
								{
									id: "c-lost",
									field: "body",
									quote: { exact: "freezes on login", prefix: "", suffix: "" },
									body: "This text changed.",
									createdAt: at,
								},
							],
						},
					},
				})
			);
			const found = container.querySelector("[data-comment='c-found']") as HTMLElement;
			const lost = container.querySelector("[data-comment='c-lost']") as HTMLElement;
			await vi.waitFor(() =>
				expect(lost.querySelector("[data-anchor-lost]")?.textContent).toBe(
					"quoted text no longer found"
				)
			);
			expect(lost.querySelector("s")?.textContent).toBe("freezes on login");
			expect(found.querySelector("[data-anchor-lost]")).toBeNull();
			expect(CSS.highlights.get("review-quote")?.size).toBe(1);
		});

		async function select(container: HTMLElement, word: string) {
			const body = container.querySelector(
				"[data-field='body'] [data-review-quotable]"
			) as HTMLElement;
			const text = body.firstChild as Text;
			const start = text.data.indexOf(word);
			const range = document.createRange();
			range.setStart(text, start);
			range.setEnd(text, start + word.length);
			const selection = window.getSelection() as Selection;
			selection.removeAllRanges();
			selection.addRange(range);
			body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			await tick();
		}

		it("comments on a selection from its popup, anchored by the quote", async () => {
			const { container, session } = await mount(payload());
			await select(container, "crashes");
			(container.querySelector("[data-selection-popup]") as HTMLButtonElement).click();
			await vi.waitFor(() =>
				expect(container.querySelector("textarea[aria-label='Comment']")).not.toBeNull()
			);
			const box = container.querySelector("textarea[aria-label='Comment']") as HTMLTextAreaElement;
			box.value = "Which device?";
			box.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
			button(container, "Add comment").click();
			await tick();
			expect(session()?.draft(0)?.comments[0]).toMatchObject({
				field: "body",
				body: "Which device?",
				quote: { exact: "crashes", prefix: "The app ", suffix: " when I open it on a Pixel." },
			});
		});

		it("comments on the selection when C is pressed while text is selected", async () => {
			const { container } = await mount(payload());
			await select(container, "Pixel");
			await press("c");
			await vi.waitFor(() =>
				expect(container.querySelector("textarea[aria-label='Comment']")).not.toBeNull()
			);
			expect(container.querySelector("[data-field='body']")?.textContent).toContain("“Pixel”");
		});

		it("takes the selection popup down once the text is deselected", async () => {
			const { container } = await mount(payload());
			await select(container, "app");
			expect(container.querySelector("[data-selection-popup]")).not.toBeNull();
			window.getSelection()?.removeAllRanges();
			await vi.waitFor(() => expect(container.querySelector("[data-selection-popup]")).toBeNull());
		});
	});

	describe("model guesses", () => {
		it("hides a golden set's guess until the question is answered", async () => {
			const { container } = await mount(payload());
			expect(question(container, "kind")?.querySelector("[data-model-note]")).toBeNull();
			await press("a");
			expect(mlReviews.get(REVIEW)?.draft(0)).toBeUndefined();

			await press("1");
			expect(
				question(container, "kind")?.querySelector("[data-model-note]")?.textContent
			).toContain("model agrees");

			await press("ArrowUp");
			await press("2");
			expect(
				question(container, "kind")?.querySelector("[data-model-note]")?.textContent
			).toContain("model said bug");
		});

		it("offers a review's guess up front, never pre-selected, and A accepts it", async () => {
			const { container, session } = await mount(payload({ schema: labelSchema("shown") }));
			const kind = question(container, "kind") as HTMLElement;
			expect(kind.querySelector("[data-model-note='guess']")?.getAttribute("title")).toBe(
				"mentions a crash"
			);
			expect(kind.querySelector("[aria-checked='true']")).toBeNull();
			await press("a");
			expect(session()?.draft(0)?.answers.kind).toBe("bug");
		});
	});

	describe("navigator", () => {
		it("opens with G, filters, and goes to a record by number", async () => {
			const answered = {
				status: "answered" as const,
				answers: { kind: "bug" },
				comments: [],
				updatedAt: at,
			};
			const { container } = await mount(payload({ drafts: { "0": answered } }));
			await press("g");
			const nav = container.querySelector("[data-record-navigator]") as HTMLElement;
			expect(nav).not.toBeNull();
			expect(nav.querySelectorAll("[data-record-row]")).toHaveLength(3);
			(nav.querySelector("[data-filter='todo']") as HTMLButtonElement).click();
			await tick();
			expect(nav.querySelectorAll("[data-record-row]")).toHaveLength(2);

			const input = nav.querySelector("input") as HTMLInputElement;
			input.value = "3";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			await tick();
			expect(container.querySelector("[data-record-navigator]")).toBeNull();
			expect(position(container)).toBe("3 of 3");
		});
	});

	describe("finish step", () => {
		it("lists what needs an answer, jumps to it, and holds Send until it is answered", async () => {
			const { container } = await mount(payload());
			await press("1");
			button(container, "Finish").click();
			await tick();
			const finish = container.querySelector("[data-finish-step]") as HTMLElement;
			const blocked = [...finish.querySelectorAll<HTMLElement>("[data-blocker]")];
			expect(blocked.map((row) => row.dataset.blocker)).toEqual(["1", "2"]);
			expect(blocked[1].textContent).toContain("How to export?");
			expect(container.querySelector("[data-send-reason]")?.textContent).toContain(
				"Answer #2 and #3 to send."
			);
			expect(button(container, "Send").disabled).toBe(true);

			button(blocked[1], "Go").click();
			await tick();
			expect(container.querySelector("[data-finish-step]")).toBeNull();
			expect(position(container)).toBe("3 of 3");
		});

		it("sends a note, then follows the message the server posted", async () => {
			const review = payload({ status: "detached" });
			const { container, server } = await mount(review);
			server.answerSubmit({ ok: true, files: [], delivery: "sent" });
			server.whenSubmitted(() => {
				review.status = "submitted";
				review.delivery = { status: "sent", messageId: "m-1" };
			});
			for (let i = 0; i < RECORDS.length; i += 1) {
				await press("1");
				await press("j");
			}
			button(container, "Finish").click();
			await tick();
			const note = container.querySelector("[data-finish-step] textarea") as HTMLTextAreaElement;
			note.value = "Check the dark mode one.";
			note.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
			button(container, "Send").click();

			await vi.waitFor(
				() => expect(navigation.invalidate).toHaveBeenCalledWith("conversation:id"),
				{ timeout: 5_000 }
			);
			expect(server.patches.map((patch) => patch.index).sort()).toEqual([0, 1, 2]);
			expect(server.submits[0]).toMatchObject({
				note: "Check the dark mode one.",
			});
			await vi.waitFor(() =>
				expect(container.querySelector("[data-delivery='sent']")?.textContent).toContain(
					"Posted as your message"
				)
			);
		});

		it("waits for a queued submission to be posted before following it", async () => {
			const review = payload({ status: "detached" });
			const { container, server } = await mount(review);
			server.answerSubmit({ ok: true, files: [], delivery: "queued" });
			server.whenSubmitted(() => {
				review.status = "submitted";
				review.delivery = { status: "pending" };
			});
			for (let i = 0; i < RECORDS.length; i += 1) {
				await press("1");
				await press("j");
			}
			button(container, "Finish").click();
			await tick();
			button(container, "Send").click();
			await vi.waitFor(
				() => expect(container.querySelector("[data-delivery='pending']")).not.toBeNull(),
				{ timeout: 5_000 }
			);
			expect(navigation.invalidate).not.toHaveBeenCalled();

			review.delivery = { status: "sent", messageId: "m-2" };
			await vi.waitFor(
				() => expect(navigation.invalidate).toHaveBeenCalledWith("conversation:id"),
				{ timeout: 6_000 }
			);
		});
	});

	describe("phone", () => {
		it("asks one question at a time, moves to the open one, and Next goes on", async () => {
			desktop(false);
			const { container, session } = await mount(payload());
			const dock = () => container.querySelector("[data-question-dock]") as HTMLElement;
			expect(dock().getAttribute("aria-label")).toBe("Question 1 of 2");
			expect(container.querySelector("[data-question='severity']")).toBeNull();

			button(dock(), "bug").click();
			await tick();
			expect(session()?.draft(0)?.answers.kind).toBe("bug");
			expect(dock().getAttribute("aria-label")).toBe("Question 2 of 2");

			button(dock(), "Next").click();
			await tick();
			expect(position(container)).toBe("2 of 3");
			expect(dock().getAttribute("aria-label")).toBe("Question 1 of 2");
		});
	});

	describe("pane states", () => {
		it("shows a review as detached once a turn ends and the server moved it on", async () => {
			const review = payload();
			const { container } = await mount(review);
			review.status = "detached";
			mlReviews.refreshOpen();
			await vi.waitFor(() =>
				expect(container.querySelector("[data-banner='detached']")).not.toBeNull()
			);
		});

		it("stays editable after the card that loaded it is gone", async () => {
			fakeServer(payload());
			setPage({ params: { id: CONVERSATION } });
			const card = render(MlReviewCard, {
				request: cardRequest(),
				conversationId: CONVERSATION,
				interactive: true,
			});
			await tick();
			expect(mlReviews.get(REVIEW)?.editable).toBe(false);
			card.unmount();
			await vi.waitFor(() => expect(mlReviews.get(REVIEW)?.load).toBe("ready"));

			sidePane.openReview(REVIEW);
			render(MlReviewPane);
			await tick();
			expect(mlReviews.get(REVIEW)?.editable).toBe(true);
			await press("Enter");
			await press("1");
			expect(mlReviews.get(REVIEW)?.draft(0)?.answers.kind).toBe("bug");
		});
	});

	describe("review mode", () => {
		const review = () =>
			payload({
				schema: reviewSchema,
				records: [
					{
						id: "a",
						values: { prompt: "Explain LoRA", response: "**LoRA** freezes the base weights." },
					},
					{ id: "b", values: { prompt: "Haiku about GPUs", response: "Silicon rivers" } },
				],
			});

		it("opens a short review as a list, and marks all OK in one send", async () => {
			const { container, server } = await mount(review());
			expect(container.querySelector("[data-list-view]")).not.toBeNull();
			expect(container.querySelector("[data-instructions-strip]")?.textContent).toContain(
				"Flag anything off-topic."
			);
			expect(container.querySelector("[data-row='0']")?.textContent).toContain(
				"LoRA freezes the base weights."
			);

			const footer = container.querySelector("[data-review-footer]") as HTMLElement;
			button(footer, "Mark all OK…").click();
			await tick();
			expect(footer.textContent?.replace(/\s+/g, " ")).toContain(
				"Mark the 2 remaining examples OK and send? This ends the review."
			);
			expect(server.submits).toHaveLength(0);
			button(footer, "Mark OK and send").click();
			await vi.waitFor(() => expect(server.submits[0]).toMatchObject({ approveRest: true }));
		});

		it("marks rows OK or rejects them one by one", async () => {
			const { container, session } = await mount(review());
			(
				container.querySelector("[data-row='0'] button[aria-label='Mark OK']") as HTMLButtonElement
			).click();
			(
				container.querySelector("[data-row='1'] button[aria-label='Reject']") as HTMLButtonElement
			).click();
			await tick();
			expect(session()?.draft(0)?.status).toBe("answered");
			expect(session()?.draft(1)?.status).toBe("discarded");
			const footer = container.querySelector("[data-review-footer]") as HTMLElement;
			expect(footer.textContent).toContain("1 OK · 1 rejected · 0 to review");
			expect(button(footer, "Send").className).toContain("bg-gray-900");

			(
				container.querySelector("[data-row='1'] button[aria-label='Reject']") as HTMLButtonElement
			).click();
			await tick();
			expect(session()?.draft(1)?.status).toBe("pending");
		});

		it("sends a decided review straight away, with no verdict", async () => {
			const { container, session, server } = await mount(review());
			session()?.decide([0], "approved");
			session()?.decide([1], "rejected");
			await tick();
			const footer = container.querySelector("[data-review-footer]") as HTMLElement;
			button(footer, "Send").click();
			await vi.waitFor(() => expect(server.submits).toHaveLength(1));
			expect(server.submits[0]).not.toHaveProperty("verdict");
			expect(server.submits[0]).not.toHaveProperty("approveRest");
		});

		it("asks once before an empty send, then sends it", async () => {
			const { container, server } = await mount(review());
			const footer = container.querySelector("[data-review-footer]") as HTMLElement;
			button(footer, "Send…").click();
			await tick();
			expect(footer.textContent).toContain("Send without any notes?");
			button(footer, "Send").click();
			await vi.waitFor(() => expect(server.submits).toHaveLength(1));
			expect(server.submits[0]).not.toHaveProperty("note");
			expect(server.submits[0]).not.toHaveProperty("verdict");
		});

		it("sends the note with the submission", async () => {
			const { container, session, server } = await mount(review());
			session()?.decide([0, 1], "approved");
			const open = session();
			if (open) open.note = "Retrain on these two.";
			await tick();
			button(container.querySelector("[data-review-footer]") as HTMLElement, "Send").click();
			await vi.waitFor(() =>
				expect(server.submits[0]).toMatchObject({ note: "Retrain on these two." })
			);
		});

		it("approves the open record with 1 in the one-at-a-time view", async () => {
			const { container, session } = await mount(review());
			const open = session();
			if (open) open.view = "focus";
			open?.openRecord(1);
			await tick();
			expect(container.querySelector("[data-decision-dock]")).not.toBeNull();
			await press("1");
			expect(session()?.draft(1)?.status).toBe("answered");
		});

		it("offers to mark the rest OK, and says a send ends the review", async () => {
			const { container, session, server } = await mount(review());
			session()?.decide([1], "approved");
			session()?.addComment(0, { body: "Too short." });
			await tick();
			const footer = container.querySelector("[data-review-footer]") as HTMLElement;
			expect(footer.textContent).toContain("1 comment");
			button(footer, "Send…").click();
			await tick();
			expect(footer.textContent?.replace(/\s+/g, " ")).toContain(
				"Send with 1 example not reviewed? This ends the review."
			);
			button(footer, "Cancel").click();
			await tick();
			button(footer, "Mark the rest OK…").click();
			await tick();
			button(footer, "Mark OK and send").click();
			await vi.waitFor(() => expect(server.submits[0]).toMatchObject({ approveRest: true }));
		});
	});

	describe("table view", () => {
		const intents = () =>
			payload({
				schema: {
					title: "intents",
					idField: "id",
					fields: [
						{ name: "utterance", type: "text" },
						{ name: "intent", type: "category" },
					],
					questions: [{ name: "correct", title: "Correct?", type: "boolean", required: false }],
					suggestions: "none",
				},
				records: [
					{ id: "t1", values: { utterance: "refund please", intent: "billing" } },
					{ id: "t2", values: { utterance: "app crashes", intent: "bug" } },
					{ id: "t3", values: { utterance: "dark mode?", intent: "feature" } },
				],
			});
		const openRow = (root: HTMLElement) =>
			root.querySelector("[data-row-detail]")?.getAttribute("aria-label");

		it("answers the open row with number keys and moves with J and K", async () => {
			const { container, session } = await mount(intents());
			await press("j");
			expect(openRow(container)).toBe("Row 1");
			await press("2");
			expect(session()?.draft(0)?.answers.correct).toBe(false);
			expect(openRow(container)).toBe("Row 1");
			await press("j");
			await press("ArrowDown");
			expect(openRow(container)).toBe("Row 3");
			await press("k");
			expect(openRow(container)).toBe("Row 2");
			await press("Enter");
			expect(openRow(container)).toBe("Row 3");
			await press("Escape");
			expect(container.querySelector("[data-row-detail]")).toBeNull();
		});

		it("moves to the next row after an answer when auto-advance is on", async () => {
			const { container, session } = await mount(intents());
			(container.querySelector("[data-table-row='0']") as HTMLElement).click();
			await tick();
			const toggle = container.querySelector(
				"[data-row-detail] input[type='checkbox']"
			) as HTMLInputElement;
			toggle.click();
			await tick();
			button(container.querySelector("[data-row-detail]") as HTMLElement, "Yes").click();
			await tick();
			expect(session()?.draft(0)?.answers.correct).toBe(true);
			await vi.waitFor(() => expect(openRow(container)).toBe("Row 2"));
			await press("1");
			await vi.waitFor(() => expect(openRow(container)).toBe("Row 3"));
			expect(session()?.draft(1)?.answers.correct).toBe(true);
		});

		it("marks rows correct or wrong inline and filters the wrong ones", async () => {
			const { container, session } = await mount(
				payload({
					schema: {
						title: "intents",
						idField: "id",
						fields: [
							{ name: "utterance", type: "text" },
							{ name: "intent", type: "category" },
						],
						questions: [{ name: "correct", title: "Correct?", type: "boolean", required: false }],
						suggestions: "none",
					},
					records: [
						{ id: "t1", values: { utterance: "refund please", intent: "billing" } },
						{ id: "t2", values: { utterance: "app crashes", intent: "bug" } },
					],
				})
			);
			expect(container.querySelector("[data-table-view]")).not.toBeNull();
			(
				container.querySelector(
					"[data-table-row='0'] button[aria-label='Wrong']"
				) as HTMLButtonElement
			).click();
			(
				container.querySelector(
					"[data-table-row='1'] button[aria-label='Correct']"
				) as HTMLButtonElement
			).click();
			await tick();
			expect(session()?.draft(0)?.answers.correct).toBe(false);
			expect(session()?.draft(1)?.answers.correct).toBe(true);

			(container.querySelector("[data-filter='wrong']") as HTMLButtonElement).click();
			await tick();
			expect(container.querySelectorAll("[data-table-row]")).toHaveLength(1);

			(container.querySelector("[data-table-row='0']") as HTMLElement).click();
			await tick();
			expect(container.querySelector("[data-row-detail]")?.textContent).toContain("refund please");
		});
	});

	describe("media comments", () => {
		const mediaReview = (fields: ReviewSchema["fields"], values: Record<string, unknown>) =>
			payload({
				schema: {
					title: "clips",
					idField: "id",
					fields,
					questions: [{ name: "ok", type: "boolean", required: true }],
					suggestions: "none",
				},
				records: [{ id: "c1", values }],
			});

		async function addComment(container: HTMLElement, body: string) {
			await vi.waitFor(() =>
				expect(container.querySelector("textarea[aria-label='Comment']")).not.toBeNull()
			);
			const box = container.querySelector("textarea[aria-label='Comment']") as HTMLTextAreaElement;
			box.value = body;
			box.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
			button(container, "Add comment").click();
			await tick();
		}

		const pointer = (target: Element, type: string, fx: number, fy = 0.5) => {
			const box = target.getBoundingClientRect();
			target.dispatchEvent(
				new PointerEvent(type, {
					bubbles: true,
					pointerId: 1,
					button: 0,
					clientX: box.left + box.width * fx,
					clientY: box.top + box.height * fy,
				})
			);
		};

		async function drag(target: Element, from: [number, number], to: [number, number]) {
			pointer(target, "pointerdown", ...from);
			pointer(target, "pointermove", ...to);
			pointer(target, "pointerup", ...to);
			await tick();
		}

		it("comments on an audio clip at the playhead with C", async () => {
			const { container, session } = await mount(
				mediaReview([{ name: "clip", type: "audio" }], { clip: "hf://datasets/o/s/local.wav" })
			);
			expect(container.querySelector("[data-media-stage='audio']")).not.toBeNull();
			await press("c");
			expect(container.querySelector("[data-composer-anchor]")?.textContent).toContain("0:00");
			await addComment(container, "Speaker overlap");
			expect(session()?.draft(0)?.comments[0]).toMatchObject({
				field: "clip",
				time: { start: 0 },
				body: "Speaker overlap",
			});
			expect(container.querySelector("[data-time-pin='1']")).not.toBeNull();
		});

		it("comments on a range dragged along the audio bar", async () => {
			const { container, session } = await mount(
				mediaReview([{ name: "clip", type: "audio" }], { clip: "hf://datasets/o/s/local.wav" })
			);
			const bar = container.querySelector("[data-seek-bar]") as HTMLElement;
			await vi.waitFor(() => expect(bar.getAttribute("aria-valuemax")).toBe("1"));
			await drag(bar, [0.1, 0.5], [0.6, 0.5]);
			await addComment(container, "Drops out");
			const time = session()?.draft(0)?.comments[0]?.time;
			expect(time?.start).toBeCloseTo(0.1, 1);
			expect(time?.end).toBeCloseTo(0.6, 1);
		});

		it("draws an area on an image straight away, M turns drawing off", async () => {
			const { container, session } = await mount(
				mediaReview([{ name: "image", type: "image" }], { image: "hf://datasets/o/s/local.svg" })
			);
			const layer = container.querySelector("[data-area-layer]") as HTMLElement;
			await drag(layer, [0.25, 0.1], [0.75, 0.6]);
			expect(container.querySelector("[data-composer-anchor]")?.textContent).toContain(
				"area 25%,10% 50%x50%"
			);
			await addComment(container, "Garbled sign");
			const comment = session()?.draft(0)?.comments[0];
			expect(comment?.field).toBe("image");
			expect(comment?.time).toBeUndefined();
			expect(comment?.area?.w).toBeCloseTo(0.5, 2);
			expect(container.querySelector("[data-area-box='1']")).not.toBeNull();

			await press("m");
			expect(layer.className).toContain("pointer-events-none");
		});

		it("pins a box on a video to the frame it was drawn on", async () => {
			const { container, session } = await mount(
				mediaReview([{ name: "video", type: "video" }], { video: "hf://datasets/o/s/local.wav" })
			);
			await press("m");
			const layer = container.querySelector(
				"[data-media-stage='video'] [data-area-layer]"
			) as HTMLElement;
			await drag(layer, [0.1, 0.1], [0.4, 0.5]);
			await addComment(container, "Sail splits");
			expect(session()?.draft(0)?.comments[0]).toMatchObject({
				field: "video",
				time: { start: 0 },
				area: { x: 0.1, y: 0.1 },
			});
		});
	});

	describe("JSON in records", () => {
		const criteria = JSON.stringify({
			false: "No annotated span has this type.",
			true: "At least one annotated span has this type.",
		});
		const jsonReview = (
			values: Record<string, unknown>,
			fields: ReviewSchema["fields"],
			drafts: ReviewPayload["drafts"] = {}
		) =>
			payload({
				schema: {
					title: "spans",
					idField: "id",
					fields: [{ name: "title", type: "text" }, ...fields],
					questions: [{ name: "ok", type: "boolean", required: true }],
					suggestions: "none",
				},
				records: [{ id: "s1", values: { title: "Span check", ...values } }],
				drafts,
			});

		it("opens a json field that holds a JSON string, as a key and value list", async () => {
			const { container } = await mount(
				jsonReview({ criteria_json: criteria }, [{ name: "criteria_json", type: "json" }])
			);
			const field = container.querySelector("[data-json-field]") as HTMLElement;
			expect(field.querySelector("[data-json-flat]")).not.toBeNull();
			expect(field.textContent).toContain("No annotated span has this type.");
			expect(field.textContent).not.toContain('\\"');
		});

		it("opens JSON nested inside a JSON string", async () => {
			const state = JSON.stringify({ step: 3, criteria });
			const { container } = await mount(
				jsonReview({ state_preview: state }, [{ name: "state_preview", type: "json" }])
			);
			const field = container.querySelector("[data-json-field]") as HTMLElement;
			expect(field.querySelectorAll("[data-json-flat]")).toHaveLength(1);
			expect(field.textContent).toContain("At least one annotated span has this type.");
		});

		it("formats a text field holding JSON, with a raw toggle", async () => {
			const { container } = await mount(
				jsonReview({ notes: criteria }, [{ name: "notes", type: "text" }])
			);
			const field = container.querySelector("[data-field='notes']") as HTMLElement;
			expect(field.querySelector("[data-json-flat]")).not.toBeNull();
			(field.querySelector("[data-json-raw-toggle]") as HTMLButtonElement).click();
			await tick();
			expect(field.querySelector("[data-json-flat]")).toBeNull();
			expect(field.querySelector("[data-review-quotable]")?.textContent).toContain(criteria);
		});

		it("folds a long string and wraps it", async () => {
			const long = "word ".repeat(200).trim();
			const { container } = await mount(
				jsonReview({ blob: JSON.stringify({ text: long, more: [1, 2] }) }, [
					{ name: "blob", type: "json" },
				])
			);
			const string = container.querySelector("[data-json-string]") as HTMLElement;
			expect(string.className).toContain("whitespace-pre-wrap");
			expect(string.textContent?.length).toBeLessThan(long.length);
			button(container.querySelector("[data-json-field]") as HTMLElement, "Show more").click();
			await tick();
			expect(container.querySelector("[data-json-string]")?.textContent).toBe(long);
		});

		it("keeps an invalid JSON string as plain text", async () => {
			const { container } = await mount(
				jsonReview({ notes: '{"broken": ' }, [{ name: "notes", type: "text" }])
			);
			const field = container.querySelector("[data-field='notes']") as HTMLElement;
			expect(field.querySelector("[data-json-raw-toggle]")).toBeNull();
			expect(field.textContent).toContain('{"broken": ');
		});

		it("anchors quotes to the formatted text, or says the anchor is lost", async () => {
			const comment = (id: string, exact: string) => ({
				id,
				field: "notes",
				quote: { exact, prefix: "", suffix: "" },
				body: id,
				createdAt: new Date(),
			});
			const { container } = await mount(
				jsonReview({ notes: criteria }, [{ name: "notes", type: "text" }], {
					"0": {
						status: "pending",
						answers: {},
						comments: [comment("kept", "At least one"), comment("gone", '"true":')],
						updatedAt: new Date(),
					},
				})
			);
			await vi.waitFor(() =>
				expect(container.querySelector("[data-comment='gone'] [data-anchor-lost]")).not.toBeNull()
			);
			expect(container.querySelector("[data-comment='kept'] [data-anchor-lost]")).toBeNull();
		});
	});

	describe("image grid", () => {
		it("adds one comment to each selected image", async () => {
			const { container, session } = await mount(
				payload({
					schema: {
						title: "photos",
						idField: "id",
						fields: [
							{ name: "image", type: "image" },
							{ name: "label", type: "category" },
						],
						questions: [],
						suggestions: "none",
					},
					records: [1, 2, 3].map((n) => ({
						id: `i${n}`,
						values: { image: `hf://datasets/o/s/${n}.png`, label: "food" },
					})),
				})
			);
			expect(container.querySelector("[data-grid-view]")).not.toBeNull();
			(container.querySelector("[data-tile='0']") as HTMLButtonElement).click();
			tileClick(container, 2, { ctrlKey: true });
			await tick();
			button(container, "Comment").click();
			await tick();
			const box = container.querySelector("[data-selection-bar] textarea") as HTMLTextAreaElement;
			box.value = "Not food.";
			box.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
			button(container, "Add to both").click();
			await tick();
			expect(session()?.draft(0)?.comments[0]).toMatchObject({ body: "Not food.", field: "image" });
			expect(session()?.draft(1)).toBeUndefined();
			expect(session()?.draft(2)?.comments[0]).toMatchObject({ body: "Not food." });
		});

		const tileClick = (root: HTMLElement, index: number, init: MouseEventInit = {}) =>
			root
				.querySelector(`[data-tile='${index}']`)
				?.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
		const selectedTiles = (root: HTMLElement) =>
			[...root.querySelectorAll("[data-tile][aria-pressed='true']")].map((tile) =>
				Number(tile.getAttribute("data-tile"))
			);
		const rocks = (questions: ReviewSchema["questions"] = []) =>
			payload({
				schema: {
					title: "rocks",
					idField: "id",
					fields: [{ name: "image", type: "image" }],
					questions,
					suggestions: "none",
				},
				records: [1, 2, 3, 4, 5].map((n) => ({
					id: `r${n}`,
					values: { image: `hf://datasets/o/s/${n}.png` },
				})),
			});

		it("selects one on click, adds with ctrl or cmd, and a range with shift", async () => {
			const { container } = await mount(rocks());
			tileClick(container, 0);
			tileClick(container, 3);
			await tick();
			expect(selectedTiles(container)).toEqual([3]);
			tileClick(container, 1, { metaKey: true });
			await tick();
			expect(selectedTiles(container)).toEqual([1, 3]);
			tileClick(container, 4, { shiftKey: true });
			await tick();
			expect(selectedTiles(container)).toEqual([1, 2, 3, 4]);
			tileClick(container, 2, { ctrlKey: true });
			await tick();
			expect(selectedTiles(container)).toEqual([1, 3, 4]);

			await press("Escape");
			expect(selectedTiles(container)).toEqual([]);
			button(container, "Select all").click();
			await tick();
			expect(selectedTiles(container)).toEqual([0, 1, 2, 3, 4]);
			button(container, "Deselect all").click();
			await tick();
			expect(selectedTiles(container)).toEqual([]);
		});

		it("marks OK or rejects only the selected images, the footer waits", async () => {
			const { container, session, server } = await mount(rocks());
			tileClick(container, 0);
			tileClick(container, 2, { ctrlKey: true });
			await tick();
			expect(container.querySelector("[data-review-footer]")).toBeNull();
			button(container, "Mark 2 OK").click();
			await tick();
			expect(session()?.draft(0)?.status).toBe("answered");
			expect(session()?.draft(1)).toBeUndefined();
			expect(session()?.draft(2)?.status).toBe("answered");
			expect(server.submits).toHaveLength(0);
			expect(container.querySelector("[data-tile='0']")?.getAttribute("data-decision")).toBe(
				"approved"
			);

			tileClick(container, 4);
			await tick();
			button(container, "Reject 1").click();
			await tick();
			expect(session()?.draft(4)?.status).toBe("discarded");
			const footer = container.querySelector("[data-review-footer]") as HTMLElement;
			expect(footer.textContent).toContain("2 OK · 1 rejected · 2 to review");
		});

		it("sets the yes/no question when the review has one", async () => {
			const { container, session } = await mount(
				rocks([{ name: "ok", title: "Label right?", type: "boolean", required: false }])
			);
			tileClick(container, 1);
			await tick();
			button(container, "Reject 1").click();
			await tick();
			expect(session()?.draft(1)?.answers.ok).toBe(false);
		});

		const photos = () =>
			payload({
				schema: {
					title: "photos",
					idField: "id",
					fields: [{ name: "image", type: "image" }],
					questions: [],
					suggestions: "none",
				},
				records: [1, 2, 3].map((n) => ({
					id: `i${n}`,
					values: { image: `hf://datasets/o/s/${n}.png` },
				})),
			});

		it("opens the focused image on Enter", async () => {
			const { container } = await mount(photos());
			const tile = container.querySelector("[data-tile='1']") as HTMLButtonElement;
			tile.focus();
			await press("Enter", tile);
			expect(container.querySelector("[data-grid-view]")).toBeNull();
			expect(position(container)).toContain("2 of 3");
		});

		it("opens an image from its open button", async () => {
			const { container } = await mount(photos());
			(container.querySelector("button[aria-label='Open image 3']") as HTMLButtonElement).click();
			await tick();
			expect(position(container)).toContain("3 of 3");
		});
	});
});

describe("MlReviewCard", () => {
	afterEach(() => {
		mlReviews.reset();
		sidePane.reset();
		vi.unstubAllGlobals();
	});

	async function card(review: ReviewPayload, request = cardRequest()) {
		const server = fakeServer(review);
		setPage({ params: { id: CONVERSATION } });
		const screen = render(MlReviewCard, {
			request,
			conversationId: CONVERSATION,
			interactive: true,
		});
		await vi.waitFor(() => expect(mlReviews.get(REVIEW)?.load).toBe("ready"));
		await tick();
		return { ...screen, server };
	}

	it("starts a label review, then continues where the user left off", async () => {
		const { container } = await card(payload());
		expect(container.textContent).toContain("Start labelling");
		expect(container.textContent).toContain("the model's guesses stay hidden until you answer");

		mlReviews.get(REVIEW)?.setAnswer(0, "kind", "bug");
		await tick();
		expect(container.querySelector("[data-card-tally]")?.textContent).toContain("1 of 3 answered");
		button(container, "Continue at #2").click();
		expect(sidePane.reviewId).toBe(REVIEW);
		expect(mlReviews.get(REVIEW)?.focus).toBe(1);
	});

	it("does not bring its session back after the store resets", async () => {
		await card(payload());
		mlReviews.reset();
		await tick();
		expect(mlReviews.get(REVIEW)).toBeUndefined();
		expect(mlReviews.conversationId).toBeUndefined();
	});

	it("asks before marking a whole review OK unopened", async () => {
		const { container, server } = await card(
			payload({
				schema: reviewSchema,
				records: [{ id: "a", values: { prompt: "p", response: "r" } }],
			}),
			cardRequest({ mode: "review", records: 1, questions: 0 })
		);
		button(container, "Mark all 1 OK").click();
		await tick();
		expect(container.textContent).toContain("Mark all 1 OK without opening any?");
		expect(server.submits).toHaveLength(0);
		button(container, "Mark OK and send").click();
		await vi.waitFor(() => expect(server.submits[0]).toMatchObject({ approveRest: true }));
	});
});
