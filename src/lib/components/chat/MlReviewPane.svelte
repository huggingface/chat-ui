<script lang="ts">
	import { untrack } from "svelte";
	import { page } from "$app/state";
	import { mlReviews, type ReviewView } from "$lib/stores/mlReview.svelte";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import type { ReviewQuestion, ReviewVerdict } from "$lib/types/MlReview";
	import { useIsDesktop } from "$lib/utils/isDesktop.svelte";
	import { formatFileRef } from "$lib/utils/mlRegistry";
	import { isAnswered } from "$lib/utils/review/answers";
	import {
		isTabular,
		leadImageField,
		passFailQuestion,
		recordDecision,
		type RecordDecision,
	} from "$lib/utils/review/progress";
	import {
		AUTO_ADVANCE_MS,
		deliveryLabel,
		keyOptions,
		pick,
		suggestionVisible,
	} from "$lib/utils/review/view";
	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import SidePane from "./SidePane.svelte";
	import FinishStep from "../review/FinishStep.svelte";
	import GridView from "../review/GridView.svelte";
	import ListView from "../review/ListView.svelte";
	import ProgressBar, { type BarState } from "../review/ProgressBar.svelte";
	import QuestionPanel from "../review/QuestionPanel.svelte";
	import RecordBody from "../review/RecordBody.svelte";
	import RecordNavigator from "../review/RecordNavigator.svelte";
	import ReviewFooter from "../review/ReviewFooter.svelte";
	import StartStep from "../review/StartStep.svelte";
	import TableView from "../review/TableView.svelte";
	import { takeSelectionComment } from "../review/quoteAnchors";
	import { mediaKeys } from "../review/mediaKeys";

	import CarbonCheckmark from "~icons/carbon/checkmark";
	import CarbonCheckmarkFilled from "~icons/carbon/checkmark-filled";
	import CarbonClose from "~icons/carbon/close";
	import CarbonChevronDown from "~icons/carbon/chevron-down";
	import CarbonChevronLeft from "~icons/carbon/chevron-left";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonDocument from "~icons/carbon/document";
	import CarbonInformation from "~icons/carbon/information";
	import CarbonKeyboard from "~icons/carbon/keyboard";
	import CarbonList from "~icons/carbon/list";
	import CarbonTime from "~icons/carbon/time";
	import CarbonWarning from "~icons/carbon/warning-alt";

	const VERDICT_LABEL: Record<ReviewVerdict, string> = {
		approve: "Approved",
		request_changes: "Changes requested",
		comment: "Commented",
	};
	const VIEW_LABEL: Record<ReviewView, string> = {
		list: "List",
		table: "Table",
		grid: "Grid",
		focus: "One at a time",
	};
	const KEYS: [string, string][] = [
		["Answer the highlighted question", "1–9"],
		["Next unanswered", "↵"],
		["Previous / next record", "K J"],
		["Move between questions", "↑ ↓"],
		["Comment", "C"],
		["Skip record", "S"],
		["Go to record", "G"],
		["Accept the model's answer", "A"],
	];
	const PLAYER_KEYS: [string, string][] = [
		["Play / pause", "Space"],
		["Back / forward 5 s", "← →"],
	];
	const FRAME_KEYS: [string, string][] = [["Previous / next frame", ", ."]];
	const AREA_KEYS: [string, string][] = [["Mark an area", "M"]];
	/** a short review shows its instructions as a strip, a long one keeps them in the title */
	const SHORT_REVIEW = 20;
	/** wide enough for a question column and comment margins beside the record */
	const WIDE_PX = 900;
	const AUTO_ADVANCE_KEY = "mlReviewAutoAdvance";

	const isDesktop = useIsDesktop();

	let reviewId = $derived(sidePane.reviewId);
	let showing = $derived(sidePane.open && sidePane.view === "review" && !!reviewId);
	let conversationId = $derived(page.params?.id);

	$effect(() => {
		if (showing && conversationId && reviewId) {
			const ids = [conversationId, reviewId] as const;
			untrack(() => mlReviews.ensure(...ids));
		}
	});

	let session = $derived(showing ? mlReviews.get(reviewId) : undefined);
	let schema = $derived(session?.schema);
	let records = $derived(session?.records ?? []);
	let status = $derived(session?.payload?.status);
	let phone = $derived(!isDesktop.current);
	let width = $state(0);
	let wide = $derived(width >= WIDE_PX);

	let views = $derived.by((): ReviewView[] => {
		if (!schema || phone) return ["focus"];
		const out: ReviewView[] = [];
		if (leadImageField(schema)) out.push("grid");
		if (isTabular(schema, records)) out.push("table");
		if (!session?.labelling && !out.includes("grid")) out.push("list");
		out.push("focus");
		return session?.labelling ? ["focus", ...out.filter((view) => view !== "focus")] : out;
	});
	let view = $derived<ReviewView>(
		session?.view && views.includes(session.view) ? session.view : (views[0] ?? "focus")
	);
	let screen = $derived(
		session?.screen ??
			(session?.labelling && session.editable && session.states.every((state) => state === "todo")
				? "start"
				: "work")
	);
	let focus = $derived(Math.min(session?.focus ?? 0, Math.max(0, records.length - 1)));
	let keyable = $derived((schema?.questions ?? []).filter((question) => question.type !== "text"));
	let questions = $derived(schema?.questions ?? []);
	let keyList = $derived.by(() => {
		const types = new Set(schema?.fields.map((field) => field.type));
		return [
			...(schema?.questions.length === 0
				? ([["Approve / reject", "1 2"]] as [string, string][])
				: []),
			...KEYS,
			...(types.has("audio") || types.has("video") ? PLAYER_KEYS : []),
			...(types.has("video") ? FRAME_KEYS : []),
			...(types.has("image") || types.has("video") ? AREA_KEYS : []),
		];
	});
	let check = $derived(schema ? passFailQuestion(schema) : undefined);

	let chosenQuestion = $state<string | undefined>(undefined);
	let composeNonce = $state(0);
	let keysOpen = $state(false);
	let gridSelecting = $state(false);
	let instructionsOpen = $state(false);
	let mainEl: HTMLElement | undefined = $state();
	let autoAdvance = $state(readAutoAdvance());
	let advanceTimer: ReturnType<typeof setTimeout> | undefined;

	let activeQuestion = $derived.by(() => {
		if (chosenQuestion && questions.some((question) => question.name === chosenQuestion)) {
			return chosenQuestion;
		}
		const answers = session?.draft(focus)?.answers ?? {};
		return (
			keyable.find((question) => !isAnswered(answers[question.name])) ??
			keyable[0] ??
			questions[0]
		)?.name;
	});

	let barStates = $derived<BarState[]>(
		records.map((_, index) => {
			if (check) {
				const value = session?.draft(index)?.answers[check.name];
				if (value === true) return "pass";
				if (value === false) return "fail";
			}
			return session?.states[index] ?? "todo";
		})
	);
	let commented = $derived(
		new Set(
			records.flatMap((_, index) =>
				(session?.draft(index)?.comments.length ?? 0) > 0 ? [index] : []
			)
		)
	);
	let left = $derived(session?.states.filter((state) => state === "todo").length ?? 0);
	let barLabel = $derived(
		`Record ${focus + 1} of ${records.length}: ${session?.counts.answered ?? 0} answered, ${session?.counts.skipped ?? 0} skipped, ${left} left. Click to jump.`
	);

	let saveState = $derived.by(() => {
		if (!session?.editable) return undefined;
		if (session.saveErrors.size > 0) {
			return { kind: "error" as const, text: `Not saved: ${[...session.saveErrors.values()][0]}` };
		}
		if (session.saving > 0) return { kind: "saving" as const, text: "Saving…" };
		return { kind: "saved" as const, text: "Saved" };
	});

	function readAutoAdvance(): boolean {
		try {
			return localStorage.getItem(AUTO_ADVANCE_KEY) === "true";
		} catch {
			return false;
		}
	}

	function setAutoAdvance(on: boolean) {
		autoAdvance = on;
		try {
			localStorage.setItem(AUTO_ADVANCE_KEY, String(on));
		} catch {
			// a blocked storage only loses the preference
		}
	}

	$effect(() => {
		void focus;
		if (view === "focus") untrack(() => mainEl?.scrollTo({ top: 0 }));
	});

	function setView(next: ReviewView) {
		if (session) session.view = next;
	}

	function setScreen(next: "start" | "work" | "finish") {
		if (session) session.screen = next;
	}

	function goTo(index: number, question?: string) {
		if (!session) return;
		clearTimeout(advanceTimer);
		session.openRecord(index);
		if (view !== "focus" && views.includes("focus") && session.labelling) session.view = "focus";
		chosenQuestion = question;
	}

	function move(step: number) {
		goTo(focus + step);
	}

	function nextUnanswered() {
		if (!session) return;
		for (let n = 1; n <= records.length; n += 1) {
			const index = (focus + n) % records.length;
			if (session.states[index] === "todo") {
				goTo(index);
				return;
			}
		}
		setScreen("finish");
	}

	function skip() {
		if (!session) return;
		session.skip(focus);
		move(1);
	}

	/** a typed answer never moves on, only a pick that fills the last pickable question does */
	function afterAnswer(question: ReviewQuestion) {
		if (!autoAdvance || !session || question.type === "text" || keyable.length === 0) return;
		const answers = session.draft(focus)?.answers ?? {};
		if (!keyable.every((candidate) => isAnswered(answers[candidate.name]))) return;
		const from = focus;
		clearTimeout(advanceTimer);
		advanceTimer = setTimeout(() => {
			if (focus === from && view === "focus" && screen === "work") move(1);
		}, AUTO_ADVANCE_MS);
	}

	/** a review with no questions is approved or rejected record by record */
	function decideFocus(decision: RecordDecision) {
		if (!session?.schema || !session.editable) return;
		const current = recordDecision(session.schema, session.draft(focus));
		const next = current === decision ? undefined : decision;
		session.decide([focus], next);
		if (!autoAdvance || !next) return;
		const from = focus;
		clearTimeout(advanceTimer);
		advanceTimer = setTimeout(() => {
			if (focus === from && view === "focus" && screen === "work") move(1);
		}, AUTO_ADVANCE_MS);
	}

	function answerByKey(question: ReviewQuestion, n: number) {
		if (!session) return;
		const option = keyOptions(question)[n - 1];
		if (!option) return;
		const current = session.draft(focus)?.answers[question.name];
		const next = pick(question, current, option.value);
		session.setAnswer(
			focus,
			question.name,
			Array.isArray(next) && next.length === 0 ? undefined : next
		);
		afterAnswer(question);
		if (question.type === "multi_label") return;
		const answers = session.draft(focus)?.answers ?? {};
		const at = keyable.findIndex((candidate) => candidate.name === question.name);
		const after = [...keyable.slice(at + 1), ...keyable.slice(0, at)].find(
			(candidate) => !isAnswered(answers[candidate.name])
		);
		chosenQuestion = after?.name ?? question.name;
	}

	function stepQuestion(step: number) {
		if (questions.length === 0) return;
		const at = questions.findIndex((question) => question.name === activeQuestion);
		const next = questions.at(Math.max(0, Math.min(questions.length - 1, at + step)));
		if (next) chosenQuestion = next.name;
	}

	const isTyping = (target: EventTarget | null) =>
		target instanceof HTMLElement &&
		(target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

	function onkeydown(e: KeyboardEvent) {
		if (!showing || !session?.payload || e.defaultPrevented) return;
		if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
		if (e.key === "Escape" && (keysOpen || instructionsOpen || session.navigatorOpen)) {
			e.preventDefault();
			keysOpen = false;
			instructionsOpen = false;
			session.navigatorOpen = false;
			return;
		}
		if (e.key === "?") {
			e.preventDefault();
			keysOpen = !keysOpen;
			return;
		}
		if (screen === "start") {
			if (e.key === "Enter") {
				e.preventDefault();
				goTo(Math.max(0, session.states.indexOf("todo")));
			}
			return;
		}
		if (screen !== "work" || view !== "focus" || records.length === 0 || session.navigatorOpen)
			return;
		const key = e.key.toLowerCase();
		const question = questions.find((candidate) => candidate.name === activeQuestion);
		const media = mediaKeys();
		const onControl =
			e.target instanceof Element && !!e.target.closest("button, a, [role='slider']");
		if (e.key === " " && media?.toggle && !onControl) {
			e.preventDefault();
			media.toggle();
		} else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && media?.seek) {
			e.preventDefault();
			media.seek(e.key === "ArrowLeft" ? -1 : 1);
		} else if ((e.key === "," || e.key === ".") && media?.step) {
			e.preventDefault();
			media.step(e.key === "," ? -1 : 1);
		} else if (key === "m" && media?.mark && session.editable) {
			e.preventDefault();
			media.mark();
		} else if ((e.key === "1" || e.key === "2") && questions.length === 0 && session.editable) {
			e.preventDefault();
			decideFocus(e.key === "1" ? "approved" : "rejected");
		} else if (/^[1-9]$/.test(e.key)) {
			if (!question || question.type === "text" || !session.editable) return;
			e.preventDefault();
			answerByKey(question, Number(e.key));
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (questions.length === 0) return;
			e.preventDefault();
			stepQuestion(e.key === "ArrowDown" ? 1 : -1);
		} else if (key === "j") {
			e.preventDefault();
			move(1);
		} else if (key === "k") {
			e.preventDefault();
			move(-1);
		} else if (key === "g") {
			e.preventDefault();
			session.navigatorOpen = true;
		} else if (key === "c") {
			if (!session.editable) return;
			e.preventDefault();
			const selection = takeSelectionComment();
			if (selection) selection();
			else if (media?.comment) media.comment();
			else composeNonce += 1;
		} else if (key === "a") {
			if (!question || !session.editable) return;
			const suggestion = records[focus]?.suggestions?.[question.name];
			const current = session.draft(focus)?.answers[question.name];
			if (!suggestion || !suggestionVisible(schema?.suggestions ?? "none", current)) return;
			e.preventDefault();
			session.setAnswer(focus, question.name, suggestion.value);
			afterAnswer(question);
		} else if (key === "s") {
			if (!session.editable) return;
			e.preventDefault();
			skip();
		} else if (e.key === "Enter") {
			e.preventDefault();
			nextUnanswered();
		}
	}

	function flushOnHide() {
		if (document.visibilityState === "hidden") void mlReviews.flushAll({ keepalive: true });
	}

	const iconButton =
		"inline-flex size-8 flex-none items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100";
	const plainButton =
		"inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[13px] font-semibold whitespace-nowrap text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800";
</script>

{#snippet decisionDock()}
	{#if session?.schema && session.editable && questions.length === 0}
		{@const decision = recordDecision(session.schema, session.draft(focus))}
		<section
			aria-label="Decision"
			class="flex flex-none flex-wrap items-center gap-2 border-t border-gray-200 bg-white py-2.5 pr-3 pl-4 dark:border-gray-800 dark:bg-gray-900"
			data-decision-dock
		>
			<button
				type="button"
				class={[
					"inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium",
					decision === "approved"
						? "border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-500 dark:text-gray-900"
						: "border-gray-200 text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800",
				]}
				aria-pressed={decision === "approved"}
				onclick={() => decideFocus("approved")}
			>
				<kbd class="font-mono text-[10px] opacity-60">1</kbd>
				<CarbonCheckmark class="text-sm" />
				Approve
			</button>
			<button
				type="button"
				class={[
					"inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium",
					decision === "rejected"
						? "border-red-700 bg-red-700 text-white dark:border-red-500 dark:bg-red-500 dark:text-gray-900"
						: "border-gray-200 text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800",
				]}
				aria-pressed={decision === "rejected"}
				onclick={() => decideFocus("rejected")}
			>
				<kbd class="font-mono text-[10px] opacity-60">2</kbd>
				<CarbonClose class="text-sm" />
				Reject
			</button>
			<label
				class="flex min-h-8 cursor-pointer items-center gap-1.5 px-2 text-[13px] text-gray-500 dark:text-gray-400"
			>
				<input
					type="checkbox"
					class="m-0 accent-gray-900 dark:accent-gray-100"
					checked={autoAdvance}
					onchange={(e) => setAutoAdvance(e.currentTarget.checked)}
				/>
				Auto-advance
			</label>
			<span class="flex-1"></span>
			<button
				type="button"
				class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-[13px] font-semibold whitespace-nowrap text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
				onclick={nextUnanswered}
			>
				Next unreviewed <kbd class="font-mono text-[11px] opacity-60">↵</kbd>
			</button>
		</section>
	{/if}
{/snippet}

<svelte:window {onkeydown} onbeforeunload={() => void mlReviews.flushAll({ keepalive: true })} />
<svelte:document onvisibilitychange={flushOnHide} />

{#snippet saveLabel()}
	{#if saveState}
		<span
			class={[
				"flex min-w-0 items-center gap-1.5 px-2 text-xs",
				saveState.kind === "error"
					? "text-red-600 dark:text-red-400"
					: "text-gray-500 dark:text-gray-400",
			]}
			role="status"
			data-save-state={saveState.kind}
		>
			{#if saveState.kind === "saved"}
				<CarbonCheckmark class="flex-none text-[13px]" />
			{:else if saveState.kind === "saving"}
				<span class="size-1.5 flex-none rounded-full bg-gray-400"></span>
			{:else}
				<CarbonWarning class="flex-none text-[13px]" />
			{/if}
			<span class="truncate">{saveState.text}</span>
		</span>
		{#if saveState.kind === "error"}
			<button type="button" class="{plainButton} h-7" onclick={() => session?.retrySaves()}
				>Retry</button
			>
		{/if}
	{/if}
{/snippet}

{#snippet closeButton()}
	<button
		type="button"
		class={iconButton}
		aria-label="Close review"
		title="Close (Esc)"
		onclick={() => sidePane.close()}
	>
		<CarbonCloseLarge />
	</button>
{/snippet}

{#snippet keysButton()}
	<button
		type="button"
		class={iconButton}
		aria-label="Keyboard shortcuts"
		aria-expanded={keysOpen}
		onclick={() => (keysOpen = !keysOpen)}
	>
		<CarbonKeyboard />
	</button>
{/snippet}

{#snippet banners()}
	{#if session?.payload && status === "submitted"}
		<div
			class="flex flex-none flex-wrap items-center gap-2.5 border-b border-gray-200 bg-green-50 py-2.5 pr-3 pl-4 dark:border-gray-800 dark:bg-green-400/10"
			role="status"
			data-banner="submitted"
		>
			<CarbonCheckmarkFilled class="flex-none text-green-700 dark:text-green-400" />
			<div class="min-w-0 flex-1 text-[13px] text-gray-700 dark:text-gray-300">
				<b class="font-semibold text-green-700 dark:text-green-400">
					{VERDICT_LABEL[session.payload.verdict ?? "comment"]}
				</b>
				· {session.counts.answered} answered, {session.counts.skipped} skipped, {session.counts
					.comments}
				comments
				{#if session.payload.delivery}
					<span
						class={[
							"block text-xs",
							session.payload.delivery.status === "failed"
								? "text-red-600 dark:text-red-400"
								: "text-gray-500 dark:text-gray-400",
						]}
						data-delivery={session.payload.delivery.status}
					>
						{deliveryLabel(session.payload.delivery.status)}
					</span>
				{/if}
			</div>
			{#each session.payload.result?.files ?? [] as file (`${file.name}@${file.version}`)}
				<button
					type="button"
					class="{plainButton} h-7 font-medium"
					onclick={() => sidePane.openRegistry(file)}
				>
					<CarbonDocument class="text-xs" />{formatFileRef(file)}
				</button>
			{/each}
		</div>
	{:else if status === "expired"}
		<div
			class="flex flex-none items-center gap-2.5 border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-[13px] text-gray-700 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-300"
			role="status"
			data-banner="expired"
		>
			<CarbonTime class="flex-none text-gray-500" />
			Expired before it was sent. Your answers are kept here, read-only.
		</div>
	{:else if status === "detached"}
		<div
			class="flex flex-none items-center gap-2.5 bg-gray-50 px-4 py-2.5 text-[13px] leading-[1.45] text-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
			role="status"
			data-banner="detached"
		>
			<CarbonInformation class="flex-none text-gray-500" />
			<div class="flex-1">
				You replied in chat, so the agent moved on. Finish when you like; sending posts the review
				as your next message.
			</div>
		</div>
	{/if}
{/snippet}

{#if showing}
	<SidePane
		label="Review"
		escapeDisabled={keysOpen || instructionsOpen || !!session?.navigatorOpen}
	>
		<div
			class="relative flex min-h-0 flex-1 flex-col bg-white dark:bg-gray-900"
			bind:clientWidth={width}
		>
			{#if !session || session.load === "loading"}
				<div
					class="flex h-12 flex-none items-center justify-end border-b border-gray-200 px-2 dark:border-gray-800"
				>
					{@render closeButton()}
				</div>
				<div class="flex flex-col gap-2.5 p-6" aria-busy="true" role="status" aria-label="Loading">
					<div class="h-4 w-4/5 rounded-md bg-gray-100 dark:bg-gray-800"></div>
					<div class="h-2.5 w-1/2 rounded-md bg-gray-100 dark:bg-gray-800"></div>
					<div class="mt-2 h-2.5 w-11/12 rounded-md bg-gray-100 dark:bg-gray-800"></div>
				</div>
			{:else if session.load === "missing" || session.load === "error"}
				<div
					class="flex h-12 flex-none items-center justify-end border-b border-gray-200 px-2 dark:border-gray-800"
				>
					{@render closeButton()}
				</div>
				<div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
					{#if session.load === "missing"}
						<div class="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
							Review not found
						</div>
						<div class="text-xs text-gray-500 dark:text-gray-400">
							It may have been deleted with its conversation.
						</div>
					{:else}
						<div class="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
							Couldn't load
						</div>
						<button type="button" class={plainButton} onclick={() => session?.refresh()}
							>Retry</button
						>
					{/if}
				</div>
			{:else if session.payload && schema}
				{#if screen === "start"}
					<header
						class="flex h-12 flex-none items-center gap-2 border-b border-gray-200 pr-2 pl-4 dark:border-gray-800"
					>
						<h2
							class="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
						>
							{schema.title}
						</h2>
						{@render keysButton()}
						{@render closeButton()}
					</header>
					<StartStep
						{session}
						onstart={(index) => goTo(index)}
						onbrowse={() => {
							setScreen("work");
							session.navigatorOpen = true;
						}}
					/>
				{:else if screen === "finish"}
					<header
						class="flex h-12 flex-none items-center gap-1 border-b border-gray-200 px-2 dark:border-gray-800"
					>
						<button
							type="button"
							class="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
							onclick={() => setScreen("work")}
						>
							<CarbonChevronLeft />Back{view === "focus" ? ` to #${focus + 1}` : ""}
						</button>
						<h2
							class="m-0 min-w-0 flex-1 truncate text-center text-sm font-semibold text-gray-900 dark:text-gray-100"
						>
							{schema.title}
						</h2>
						{@render saveLabel()}
						{@render closeButton()}
					</header>
					{@render banners()}
					<FinishStep {session} onsubmitted={() => setScreen("work")} />
				{:else if phone}
					<header
						class="flex h-[52px] flex-none items-center border-b border-gray-200 px-1 dark:border-gray-800"
					>
						{@render closeButton()}
						<div class="flex flex-1 flex-col items-center gap-px text-center">
							<span
								class="text-sm font-semibold text-gray-900 dark:text-gray-100"
								data-focus-position
							>
								{focus + 1} of {records.length}
							</span>
							<span class="text-[11.5px] text-gray-500 dark:text-gray-400">
								{left} left{saveState
									? ` · ${saveState.kind === "saved" ? "saved" : saveState.text}`
									: ""}
							</span>
						</div>
						<button
							type="button"
							class={iconButton}
							aria-label="All records"
							onclick={() => (session.navigatorOpen = true)}
						>
							<CarbonList />
						</button>
					</header>
					<div class="flex h-[3px] flex-none items-center overflow-hidden">
						<ProgressBar states={barStates} current={focus} label={barLabel} />
					</div>
					{@render banners()}
					<main
						bind:this={mainEl}
						class="scrollbar-custom min-h-0 flex-1 overflow-y-auto px-4 py-5"
					>
						{#key focus}
							<RecordBody {session} index={focus} {composeNonce} mediaKeys />
						{/key}
					</main>
					{#if questions.length > 0}
						<QuestionPanel
							{session}
							index={focus}
							layout="phone"
							{activeQuestion}
							onactivequestion={(name) => (chosenQuestion = name)}
							onanswer={afterAnswer}
							onskip={skip}
							onnext={nextUnanswered}
							oncomment={() => (composeNonce += 1)}
							{autoAdvance}
							onautoadvance={setAutoAdvance}
						/>
					{:else}
						{@render decisionDock()}
					{/if}
				{:else}
					<header
						class="flex h-12 flex-none items-center gap-1 border-b border-gray-200 px-2 dark:border-gray-800"
					>
						{#if view === "focus"}
							<button
								type="button"
								class={iconButton}
								aria-label="All records"
								title="All records (G)"
								onclick={() => (session.navigatorOpen = true)}
							>
								<CarbonList />
							</button>
						{/if}
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-gray-900 disabled:cursor-default dark:text-gray-100"
							aria-expanded={schema.instructions ? instructionsOpen : undefined}
							disabled={!schema.instructions}
							title={schema.instructions ? "Instructions" : undefined}
							onclick={() => (instructionsOpen = !instructionsOpen)}
						>
							<h2 class="m-0 truncate text-sm font-semibold">{schema.title}</h2>
							{#if schema.instructions}
								<CarbonChevronDown class="flex-none text-sm text-gray-500" />
							{/if}
						</button>
						{#if views.length > 1}
							<div
								class="flex flex-none rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800"
								role="group"
								aria-label="View"
							>
								{#each views as option (option)}
									<button
										type="button"
										class={[
											"h-[26px] rounded-md px-2.5 text-xs font-medium whitespace-nowrap",
											option === view
												? "bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100"
												: "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200",
										]}
										aria-pressed={option === view}
										onclick={() => setView(option)}
									>
										{VIEW_LABEL[option]}
									</button>
								{/each}
							</div>
						{/if}
						{@render saveLabel()}
						{#if view === "focus"}
							{@render keysButton()}
						{/if}
						{@render closeButton()}
					</header>

					{#if instructionsOpen && schema.instructions}
						<div
							class="absolute top-12 right-3 left-3 z-30 scrollbar-custom max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900"
							role="dialog"
							aria-label="Instructions"
						>
							<div class="prose max-w-none text-sm dark:prose-invert">
								<MarkdownRenderer content={schema.instructions} />
							</div>
						</div>
					{/if}

					{@render banners()}

					{#if schema.instructions && !session.labelling && records.length <= SHORT_REVIEW && view !== "focus"}
						<div
							class="flex-none border-b border-gray-200 px-4 py-3 text-[13.5px] leading-normal text-gray-700 dark:border-gray-800 dark:text-gray-300"
							data-instructions-strip
						>
							<div
								class="prose max-w-none text-[13.5px] leading-normal dark:prose-invert prose-p:my-0"
							>
								<MarkdownRenderer content={schema.instructions} />
							</div>
						</div>
					{/if}

					{#if view === "focus"}
						<div
							class="flex h-11 flex-none items-center gap-3 border-b border-gray-200 px-2 dark:border-gray-800"
						>
							<div class="flex items-center">
								<button
									type="button"
									class={iconButton}
									aria-label="Previous record"
									disabled={focus === 0}
									onclick={() => move(-1)}
								>
									<CarbonChevronLeft />
								</button>
								<span
									class="min-w-[72px] text-center text-[13px] text-gray-500 tabular-nums dark:text-gray-400"
									data-focus-position
								>
									<b class="font-semibold text-gray-900 dark:text-gray-100">{focus + 1}</b> of {records.length}
								</span>
								<button
									type="button"
									class={iconButton}
									aria-label="Next record"
									disabled={focus >= records.length - 1}
									onclick={() => move(1)}
								>
									<CarbonChevronRight />
								</button>
							</div>
							<ProgressBar
								states={barStates}
								current={focus}
								{commented}
								label={barLabel}
								onseek={(index) => goTo(index)}
							/>
							<span
								class="text-[13px] whitespace-nowrap text-gray-500 tabular-nums dark:text-gray-400"
							>
								{left} left
							</span>
							{#if session.editable}
								<button type="button" class={plainButton} onclick={() => setScreen("finish")}
									>Finish</button
								>
							{/if}
						</div>
						<div class="flex min-h-0 flex-1">
							<main
								bind:this={mainEl}
								class="scrollbar-custom min-w-0 flex-1 overflow-y-auto px-8 pt-7 pb-8"
							>
								<div class={wide ? "" : "max-w-[620px]"}>
									{#key focus}
										<RecordBody {session} index={focus} {wide} {composeNonce} mediaKeys />
									{/key}
								</div>
							</main>
							{#if wide && questions.length > 0}
								<QuestionPanel
									{session}
									index={focus}
									layout="column"
									{activeQuestion}
									onactivequestion={(name) => (chosenQuestion = name)}
									onanswer={afterAnswer}
									onskip={skip}
									onnext={nextUnanswered}
									{autoAdvance}
									onautoadvance={setAutoAdvance}
								/>
							{/if}
						</div>
						{#if !wide && questions.length > 0}
							<QuestionPanel
								{session}
								index={focus}
								layout="dock"
								{activeQuestion}
								onactivequestion={(name) => (chosenQuestion = name)}
								onanswer={afterAnswer}
								onskip={skip}
								onnext={nextUnanswered}
								{autoAdvance}
								onautoadvance={setAutoAdvance}
							/>
						{:else if questions.length === 0}
							{@render decisionDock()}
						{/if}
					{:else if view === "list"}
						<div class="scrollbar-custom min-h-0 flex-1 overflow-y-auto">
							<ListView {session} />
						</div>
						<ReviewFooter {session} noun="examples" onfinish={() => setScreen("finish")} />
					{:else if view === "table"}
						<TableView {session} {autoAdvance} onautoadvance={setAutoAdvance} />
						<ReviewFooter {session} noun="rows" onfinish={() => setScreen("finish")} />
					{:else if view === "grid"}
						<GridView
							{session}
							bind:selecting={gridSelecting}
							onopen={(index) => {
								setView("focus");
								goTo(index);
							}}
						/>
						{#if !gridSelecting}
							<ReviewFooter {session} noun="images" onfinish={() => setScreen("finish")} />
						{/if}
					{/if}
				{/if}

				{#if session.navigatorOpen}
					<RecordNavigator {session} onclose={() => (session.navigatorOpen = false)} />
				{/if}

				{#if keysOpen}
					<div
						class="absolute top-12 right-3 z-30 grid w-[min(560px,calc(100%-24px))] grid-cols-2 gap-x-6 gap-y-2.5 rounded-xl border border-gray-200 bg-white p-4 text-[13px] shadow-lg dark:border-gray-700 dark:bg-gray-900"
						role="dialog"
						aria-label="Keyboard shortcuts"
					>
						{#each keyList as [label, keys] (label)}
							<div class="flex items-center justify-between gap-3 text-gray-700 dark:text-gray-300">
								<span>{label}</span>
								<span class="flex gap-1">
									{#each keys.split(" ") as key (key)}
										<kbd
											class="rounded border border-gray-200 bg-gray-50 px-[5px] py-[3px] font-mono text-[11px] leading-none text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
										>
											{key}
										</kbd>
									{/each}
								</span>
							</div>
						{/each}
						<p class="col-span-2 m-0 text-[11px] text-gray-400">
							Keys are off while a text box has focus.
						</p>
					</div>
				{/if}
			{/if}
		</div>
	</SidePane>
{/if}
