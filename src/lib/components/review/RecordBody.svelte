<script lang="ts">
	import { tick, untrack } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import type { ReviewSession } from "$lib/stores/mlReview.svelte";
	import type {
		ReviewArea,
		ReviewComment,
		ReviewField,
		ReviewQuote,
		ReviewTime,
	} from "$lib/types/MlReview";
	import { anchorLabel, isMediaField } from "$lib/utils/review/anchors";
	import { headingField, leadImageField, shownFields } from "$lib/utils/review/progress";
	import AnchoredNotes from "./AnchoredNotes.svelte";
	import ReviewFieldValue from "./fields/ReviewFieldValue.svelte";
	import ImageStage from "./ImageStage.svelte";
	import MediaStage from "./MediaStage.svelte";

	import CarbonChat from "~icons/carbon/chat";
	import CarbonTrashCan from "~icons/carbon/trash-can";

	interface Props {
		session: ReviewSession;
		index: number;
		/** a wide pane puts the comments of each field in a margin beside it */
		wide?: boolean;
		/** bumped to open the record comment box, the C key */
		composeNonce?: number;
		/** a list row already shows the heading in its own header */
		hideHeading?: boolean;
		/** the record's lead image or player takes the pane's media keys */
		mediaKeys?: boolean;
	}

	let {
		session,
		index,
		wide = false,
		composeNonce = 0,
		hideHeading = false,
		mediaKeys = false,
	}: Props = $props();

	let schema = $derived(session.schema);
	let record = $derived(session.records[index]);
	let draft = $derived(session.draft(index));
	let comments = $derived(draft?.comments ?? []);
	let editable = $derived(session.editable);

	let heading = $derived(schema ? headingField(schema, session.records) : undefined);
	let image = $derived(schema ? leadImageField(schema) : undefined);
	let fields = $derived(
		schema ? shownFields(schema).filter((field) => field !== heading && field !== image) : []
	);
	let meta = $derived(
		fields.filter((field) => field.type === "number" || field.type === "category")
	);
	let body = $derived(fields.filter((field) => !meta.includes(field)));
	let leadPlayer = $derived(image ? undefined : body.find(isMediaField));
	/** on the record, or on a field shown in the heading or meta line */
	let recordComments = $derived(
		comments.filter(
			(comment) =>
				comment.field !== image?.name && !body.some((field) => field.name === comment.field)
		)
	);

	const lost = new SvelteSet<string>();

	interface ComposerTarget {
		field?: string;
		quote?: ReviewQuote;
		area?: ReviewArea;
		time?: ReviewTime;
	}

	let composer = $state<ComposerTarget | undefined>(undefined);
	let composerText = $state("");
	let composerEl: HTMLTextAreaElement | undefined = $state();

	async function openComposer(target: ComposerTarget) {
		if (!editable) return;
		composer = target;
		composerText = "";
		await tick();
		composerEl?.focus();
	}

	function saveComment() {
		const text = composerText.trim();
		if (!text || !composer) return;
		session.addComment(index, { ...composer, body: text });
		composer = undefined;
		composerText = "";
	}

	let lastNonce = untrack(() => composeNonce);
	$effect(() => {
		if (composeNonce > lastNonce) {
			lastNonce = composeNonce;
			void openComposer({});
		}
	});

	function anchorsFor(field: string) {
		return comments
			.filter((comment) => comment.field === field && comment.quote)
			.map((comment) => ({ id: comment.id, quote: comment.quote as ReviewQuote }));
	}

	function reportAnchors(field: string, ids: string[]) {
		for (const comment of comments) {
			if (comment.field !== field || !comment.quote) continue;
			if (ids.includes(comment.id)) lost.add(comment.id);
			else lost.delete(comment.id);
		}
	}

	const fieldTitle = (field: ReviewField) => field.title ?? field.name;
	const metaValue = (value: unknown) =>
		value === undefined || value === null ? "—" : String(value);
	const quotable = (field: ReviewField) => field.type === "text" || field.type === "markdown";
</script>

{#snippet quoteLine(comment: ReviewComment)}
	{#if comment.quote}
		<span class="text-xs text-gray-500 dark:text-gray-400">
			on “{#if lost.has(comment.id)}<s>{comment.quote.exact}</s>{:else}{comment.quote.exact}{/if}”
			{#if lost.has(comment.id)}
				· <span data-anchor-lost>quoted text no longer found</span>
			{/if}
		</span>
	{/if}
{/snippet}

{#snippet note(comment: ReviewComment)}
	<div
		id="review-comment-{comment.id}"
		class="group/comment flex items-start gap-2.5 rounded-[10px] bg-amber-50 px-3 py-2.5 text-[13px] leading-normal dark:bg-amber-400/[0.08]"
		data-comment={comment.id}
	>
		<CarbonChat class="mt-[3px] flex-none text-sm text-amber-700 dark:text-amber-400" />
		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			{@render quoteLine(comment)}
			<span class="break-words whitespace-pre-wrap text-gray-700 dark:text-gray-300">
				{comment.body}
			</span>
		</div>
		{#if editable}
			<button
				type="button"
				class="flex-none rounded-sm p-0.5 text-gray-400 opacity-0 group-hover/comment:opacity-100 hover:text-red-600 focus:opacity-100"
				aria-label="Delete comment"
				onclick={() => session.removeComment(index, comment.id)}
			>
				<CarbonTrashCan class="text-xs" />
			</button>
		{/if}
	</div>
{/snippet}

{#snippet marginNote(comment: ReviewComment)}
	<div
		id="review-comment-{comment.id}"
		class="group/comment flex flex-col gap-1 text-[12.5px] leading-[1.45] text-gray-700 dark:text-gray-300"
		data-comment={comment.id}
	>
		<span class="flex items-center gap-1.5 text-[11.5px] text-gray-500 dark:text-gray-400">
			<span aria-hidden="true" class="size-2 rounded-[2px] bg-amber-200 dark:bg-amber-400/45"
			></span>
			You{#if comment.quote}&nbsp;·&nbsp;{@render quoteLine(comment)}{/if}
			{#if editable}
				<button
					type="button"
					class="ml-auto rounded-sm p-0.5 text-gray-400 opacity-0 group-hover/comment:opacity-100 hover:text-red-600 focus:opacity-100"
					aria-label="Delete comment"
					onclick={() => session.removeComment(index, comment.id)}
				>
					<CarbonTrashCan class="text-xs" />
				</button>
			{/if}
		</span>
		<span class="break-words whitespace-pre-wrap">{comment.body}</span>
	</div>
{/snippet}

{#snippet composerBox(field: string | undefined)}
	{#if composer && composer.field === field}
		<div class="flex flex-col gap-1.5">
			{#if composer.quote}
				<p class="truncate text-xs text-gray-500 italic dark:text-gray-400">
					“{composer.quote.exact}”
				</p>
			{:else if anchorLabel(composer)}
				<p class="font-mono text-xs text-gray-500 dark:text-gray-400" data-composer-anchor>
					at {anchorLabel(composer)}
				</p>
			{/if}
			<textarea
				bind:this={composerEl}
				bind:value={composerText}
				class="scrollbar-custom min-h-16 w-full resize-y scroll-mb-64 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
				placeholder="Leave a comment for the agent"
				aria-label="Comment"
				maxlength={2000}
				onkeydown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						composer = undefined;
					} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						saveComment();
					}
				}}
			></textarea>
			<div class="flex justify-end gap-1.5">
				<button
					type="button"
					class="btn h-8 rounded-lg px-2.5 text-[13px] font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
					onclick={() => (composer = undefined)}
				>
					Cancel
				</button>
				<button
					type="button"
					class="btn h-8 rounded-lg bg-gray-900 px-3 text-[13px] font-semibold text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
					disabled={!composerText.trim()}
					onclick={saveComment}
				>
					Add comment
				</button>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet fieldValue(field: ReviewField)}
	<ReviewFieldValue
		{field}
		value={record?.values[field.name]}
		src={field.type === "image" ? session.mediaSrc(index, field.name) : undefined}
		quotes={quotable(field) ? anchorsFor(field.name) : undefined}
		onanchors={(ids) => reportAnchors(field.name, ids)}
		oncomment={quotable(field) && editable
			? (quote) => openComposer({ field: field.name, quote })
			: undefined}
	/>
{/snippet}

{#snippet fieldLabel(field: ReviewField)}
	<div class="mb-1.5 flex items-center gap-1.5">
		<h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400">{fieldTitle(field)}</h4>
		{#if editable}
			<button
				type="button"
				class="rounded-sm p-0.5 text-gray-400 opacity-0 group-hover/field:opacity-100 hover:text-gray-700 focus:opacity-100 dark:hover:text-gray-200"
				aria-label="Comment on {fieldTitle(field)}"
				title="Comment on this field"
				onclick={() => openComposer({ field: field.name })}
			>
				<CarbonChat class="text-xs" />
			</button>
		{/if}
	</div>
{/snippet}

{#if schema && record}
	<div class="flex flex-col gap-6" data-record={index}>
		{#if image}
			{@const imageName = image.name}
			{@const imageComments = comments.filter((comment) => comment.field === imageName)}
			<div class="-mx-8 -mt-7 flex flex-col gap-3" data-field={imageName}>
				<ImageStage
					value={record.values[imageName]}
					src={session.mediaSrc(index, imageName)}
					comments={imageComments}
					pending={composer?.field === imageName ? composer.area : undefined}
					keys={mediaKeys}
					onmark={editable ? (area) => openComposer({ field: imageName, area }) : undefined}
				/>
				<div class="flex flex-col gap-2 px-8">
					<AnchoredNotes
						comments={imageComments}
						{editable}
						onremove={(id) => session.removeComment(index, id)}
					/>
					{@render composerBox(imageName)}
				</div>
			</div>
		{/if}

		{#if !hideHeading && (heading || meta.length > 0)}
			<div class="flex max-w-[540px] flex-col gap-2.5">
				{#if heading}
					<h2
						class="m-0 text-xl leading-[1.35] font-semibold text-gray-900 dark:text-gray-100"
						data-record-heading
					>
						{metaValue(record.values[heading.name])}
					</h2>
				{/if}
				{#if meta.length > 0}
					<div
						class="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-gray-500 dark:text-gray-400"
					>
						{#each meta as field (field.name)}
							<span data-field={field.name}>
								{fieldTitle(field)}
								<span class="text-gray-700 dark:text-gray-300">
									{metaValue(record.values[field.name])}
								</span>
							</span>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#each body as field (field.name)}
			{@const fieldComments = comments.filter((comment) => comment.field === field.name)}
			{#if isMediaField(field)}
				<section class="group/field flex max-w-[656px] flex-col gap-2" data-field={field.name}>
					{@render fieldLabel(field)}
					<MediaStage
						kind={field.type}
						value={record.values[field.name]}
						src={session.mediaSrc(index, field.name)}
						comments={fieldComments}
						pending={composer?.field === field.name ? composer.area : undefined}
						{editable}
						keys={mediaKeys && field === leadPlayer}
						oncompose={(anchor) => openComposer({ field: field.name, ...anchor })}
						onremove={(id) => session.removeComment(index, id)}
					/>
					{@render composerBox(field.name)}
				</section>
			{:else if wide}
				<section
					class="group/field grid grid-cols-[minmax(0,540px)_180px] gap-x-7"
					data-field={field.name}
				>
					<div class="flex min-w-0 flex-col gap-2">
						{@render fieldLabel(field)}
						{@render fieldValue(field)}
						{@render composerBox(field.name)}
					</div>
					<div class="flex flex-col gap-4 pt-6" data-margin>
						{#each fieldComments as comment (comment.id)}
							{@render marginNote(comment)}
						{/each}
					</div>
				</section>
			{:else}
				<section class="group/field flex flex-col gap-2" data-field={field.name}>
					{@render fieldLabel(field)}
					{@render fieldValue(field)}
					{#each fieldComments as comment (comment.id)}
						{@render note(comment)}
					{/each}
					{@render composerBox(field.name)}
				</section>
			{/if}
		{/each}

		<div class="flex max-w-[620px] flex-col gap-2">
			{#each recordComments as comment (comment.id)}
				{@render note(comment)}
			{/each}
			{@render composerBox(undefined)}
			{#if editable && !(composer && composer.field === undefined)}
				<button
					type="button"
					class="-ml-2 inline-flex h-8 w-fit items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
					onclick={() => openComposer({})}
				>
					<CarbonChat class="text-sm" />
					Comment on this record
					<kbd class="font-mono text-[11px] text-gray-400">C</kbd>
				</button>
			{/if}
		</div>
	</div>
{/if}
