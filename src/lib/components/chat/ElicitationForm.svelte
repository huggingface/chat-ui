<script lang="ts">
	import type {
		ElicitationAction,
		ElicitationField,
		ElicitationRequestPayload,
		ElicitationValue,
	} from "$lib/types/McpElicitation";
	import type { MessageElicitationResolvedUpdate } from "$lib/types/MessageUpdate";
	import { base } from "$app/paths";
	import CarbonLaunch from "~icons/carbon/launch";
	import CarbonChevronRight from "~icons/carbon/chevron-right";
	import BlockWrapper from "./BlockWrapper.svelte";
	import { elicitationToResume } from "$lib/stores/elicitationResume";
	import { forDateInput } from "$lib/utils/elicitationDate";

	interface Props {
		conversationId: string;
		request: ElicitationRequestPayload;
		/** Epoch ms; absent for a 2026-era prompt, which nothing is waiting on. */
		expiresAt?: number;
		resolved?: MessageElicitationResolvedUpdate;
	}

	let { conversationId, request, expiresAt, resolved }: Props = $props();

	const fields = $derived(request.fields ?? []);

	function initialValues(source: ElicitationField[]): Record<string, ElicitationValue> {
		const out: Record<string, ElicitationValue> = {};
		for (const field of source) {
			if (field.kind === "boolean") {
				out[field.name] = field.default ?? false;
			} else if (field.kind === "select" && field.multiple) {
				out[field.name] = Array.isArray(field.default) ? [...field.default] : [];
			} else if (field.kind === "select") {
				out[field.name] = typeof field.default === "string" ? field.default : "";
			} else if (
				field.kind === "string" &&
				(field.format === "date" || field.format === "date-time") &&
				field.default !== undefined
			) {
				out[field.name] = forDateInput(field.default, field.format);
			} else {
				// Kept as a string while typing; parsed back on submit.
				out[field.name] = field.default !== undefined ? String(field.default) : "";
			}
		}
		return out;
	}

	// Seeded once: re-deriving would discard whatever the user has typed.
	// svelte-ignore state_referenced_locally
	let values = $state<Record<string, ElicitationValue>>(initialValues(request.fields ?? []));
	/** Optional fields the user actually interacted with; see `payload`. */
	let touched = $state(new Set<string>());
	let submitting = $state(false);
	let error = $state<string | null>(null);
	/** Settles the form without waiting for the run to echo the outcome back. */
	let submitted = $state<ElicitationAction | null>(null);

	let now = $state(Date.now());
	let outcome = $derived(resolved?.action ?? submitted);
	let expired = $derived(!outcome && expiresAt !== undefined && now >= expiresAt);
	let open = $derived(!outcome && !expired);

	$effect(() => {
		if (!open || expiresAt === undefined) return;
		const period = expiresAt - now > 120_000 ? 30_000 : 1_000;
		const timer = setInterval(() => (now = Date.now()), period);
		return () => clearInterval(timer);
	});

	let timeLeft = $derived.by(() => {
		if (expiresAt === undefined) return "";
		const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
		if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h left`;
		if (seconds >= 120) return `${Math.floor(seconds / 60)}m left`;
		return `${seconds}s left`;
	});

	/** Hosts that only exist inside a network the user did not choose to expose. */
	const isPrivateHost = (host: string) =>
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host === "::1" ||
		host === "[::1]" ||
		/^127\./.test(host) ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
		/^169\.254\./.test(host);

	/** The spec asks clients to flag ambiguous or suspicious link targets, punycode included. */
	let urlWarnings = $derived.by(() => {
		if (!request.url) return [];
		let parsed: URL;
		try {
			parsed = new URL(request.url);
		} catch {
			return ["This link could not be read."];
		}
		const out: string[] = [];
		if (/(^|\.)xn--/i.test(parsed.hostname)) {
			out.push("This address uses punycode, which can be made to imitate another domain.");
		}
		if (parsed.protocol !== "https:") out.push("This link is not encrypted.");
		if (isPrivateHost(parsed.hostname))
			out.push("This link points into a private or local network.");
		return out;
	});

	let linkHost = $derived.by(() => {
		if (!request.url) return "";
		try {
			return new URL(request.url).host;
		} catch {
			return request.url;
		}
	});

	const textValue = (name: string): string => {
		const value = values[name];
		return typeof value === "string" || typeof value === "number" ? String(value) : "";
	};

	const isChecked = (name: string): boolean => values[name] === true;

	const pickedCount = (name: string): number => {
		const value = values[name];
		return Array.isArray(value) ? value.length : 0;
	};

	const isPicked = (name: string, option: string): boolean => {
		const value = values[name];
		return Array.isArray(value) && value.includes(option);
	};

	function set(name: string, value: ElicitationValue) {
		values = { ...values, [name]: value };
		touched = new Set(touched).add(name);
	}

	function toggleOption(name: string, option: string, checked: boolean) {
		const current = Array.isArray(values[name]) ? (values[name] as string[]) : [];
		set(name, checked ? [...current, option] : current.filter((v) => v !== option));
	}

	function payload(): Record<string, ElicitationValue> {
		const out: Record<string, ElicitationValue> = {};
		for (const field of fields) {
			const value = values[field.name];
			if (value === "" || value === undefined || value === null) continue;
			// A checkbox nobody touched is not an answer of "false" — leaving it out lets
			// the server apply its own default.
			if (
				field.kind === "boolean" &&
				!field.required &&
				field.default === undefined &&
				!touched.has(field.name)
			) {
				continue;
			}
			if (field.kind === "number") {
				const parsed = typeof value === "number" ? value : Number(value);
				if (Number.isFinite(parsed)) out[field.name] = parsed;
				continue;
			}
			// `datetime-local` has no offset, but the schema asked for RFC 3339.
			if (field.kind === "string" && field.format === "date-time" && typeof value === "string") {
				const parsed = new Date(value);
				if (!Number.isNaN(parsed.getTime())) out[field.name] = parsed.toISOString();
				continue;
			}
			out[field.name] = value;
		}
		return out;
	}

	async function send(action: ElicitationAction) {
		if (submitting || !open) return;
		submitting = true;
		error = null;
		try {
			const res = await fetch(`${base}/conversation/${conversationId}/elicitation`, {
				method: "POST",
				// Without Accept, SvelteKit answers `error()` with an HTML page.
				headers: { "Content-Type": "application/json", Accept: "application/json" },
				body: JSON.stringify({
					elicitationId: request.elicitationId,
					action,
					...(action === "accept" && request.mode === "form" ? { content: payload() } : {}),
				}),
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				error = typeof body?.message === "string" ? body.message : "Could not send your answer.";
				return;
			}
			submitted = action;
			// A parked call has nothing waiting on it, so answering only records the answer —
			// the run that continues it has to be started.
			if (body?.resume) {
				elicitationToResume.set({ conversationId, elicitationId: request.elicitationId });
			}
		} catch {
			error = "Could not send your answer.";
		} finally {
			submitting = false;
		}
	}

	// Submitting through the form is what runs the browser's own field validation.
	const formId = $derived(`elicit-form-${request.elicitationId}`);

	let showAnswers = $state(false);

	/** What was submitted: from this session if we just sent it, else from the transcript. */
	let answered = $derived(resolved?.content ?? (submitted === "accept" ? payload() : undefined));

	let settledLabel = $derived.by(() => {
		if (outcome === "accept") return request.mode === "url" ? "Opened link" : "Answered";
		if (outcome === "decline") return "Declined";
		if (resolved?.resolution === "aborted") return "Cancelled with the response";
		if (resolved?.resolution === "withdrawn") return `${request.server} stopped waiting`;
		if (expired || resolved?.resolution === "expired") return "Expired unanswered";
		return "Cancelled";
	});

	const labelFor = (name: string) => fields.find((f) => f.name === name)?.title ?? name;

	const shown = (value: ElicitationValue) =>
		Array.isArray(value) ? value.join(", ") : String(value);

	const inputClass =
		"w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white";
</script>

{#if !open}
	<BlockWrapper>
		<div class="flex max-w-full flex-col items-start gap-1 select-none">
			<button
				type="button"
				class="group/header flex max-w-full cursor-pointer items-center gap-1 text-left whitespace-nowrap focus:outline-hidden"
				onclick={() => (showAnswers = !showAnswers)}
				aria-label={showAnswers ? "Collapse" : "Expand"}
			>
				<span
					class="shrink-0 text-sm font-medium text-gray-500 transition-colors group-hover/header:text-gray-600 dark:text-gray-400 dark:group-hover/header:text-gray-300"
				>
					{settledLabel}
				</span>
				<code
					class="min-w-0 truncate rounded-sm bg-blue-50 px-1 py-px font-mono text-xs text-blue-700 opacity-90 dark:bg-blue-900/30 dark:text-blue-300"
					>{request.server}</code
				>
				<CarbonChevronRight
					class="size-3.5 shrink-0 transition-all duration-200 group-hover/header:text-gray-600 dark:group-hover/header:text-gray-300 {showAnswers
						? 'rotate-90 text-gray-600 dark:text-gray-300'
						: 'text-gray-400'}"
				/>
			</button>
		</div>

		{#if showAnswers}
			<div class="mt-2 mb-4 space-y-3 text-gray-500 dark:text-gray-400">
				<div class="space-y-1">
					<div class="text-[10px] font-semibold text-gray-400 uppercase dark:text-gray-500">
						Asked
					</div>
					<p class="text-xs whitespace-pre-wrap">{request.message}</p>
					{#if request.url}
						<p class="font-mono text-xs break-all">{request.url}</p>
					{/if}
				</div>
				{#if answered && Object.keys(answered).length > 0}
					<div class="space-y-1">
						<div class="text-[10px] font-semibold text-gray-400 uppercase dark:text-gray-500">
							Answered
						</div>
						<dl class="rounded-lg bg-gray-100 p-2 text-xs dark:bg-gray-800/70">
							{#each Object.entries(answered) as [name, value] (name)}
								<div class="flex gap-2 py-px">
									<dt class="shrink-0 font-medium text-gray-500 dark:text-gray-400">
										{labelFor(name)}
									</dt>
									<dd class="min-w-0 break-words text-gray-700 dark:text-gray-300">
										{shown(value)}
									</dd>
								</div>
							{/each}
						</dl>
					</div>
				{/if}
			</div>
		{/if}
	</BlockWrapper>
{:else}
	<BlockWrapper>
		<div
			class="rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-700 dark:bg-gray-800/40"
		>
			<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<span class="text-sm font-medium text-gray-700 dark:text-gray-200">
					{request.mode === "url" ? "Action needed" : "Input requested"}
				</span>
				<span class="text-xs text-gray-500 dark:text-gray-400">
					from <code
						class="rounded-sm bg-blue-50 px-1 py-px font-mono text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
						>{request.server}</code
					>
				</span>
				{#if open}
					<span class="ml-auto text-xs text-gray-400 tabular-nums dark:text-gray-500">
						{timeLeft}
					</span>
				{/if}
			</div>

			<p class="mt-2 text-sm whitespace-pre-wrap text-gray-600 dark:text-gray-300">
				{request.message}
			</p>

			{#if request.mode === "url" && request.url}
				<div class="mt-3">
					<a
						href={request.url}
						target="_blank"
						rel="noopener noreferrer nofollow"
						class="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white"
					>
						<CarbonLaunch class="size-3.5" />
						Open {linkHost}
					</a>
					<p class="mt-1.5 font-mono text-xs break-all text-gray-400 dark:text-gray-500">
						{request.url}
					</p>
					{#each urlWarnings as warning (warning)}
						<p class="mt-1.5 text-xs text-amber-700 dark:text-amber-500">{warning}</p>
					{/each}
				</div>
			{:else if fields.length > 0}
				<form
					id={formId}
					class="mt-3 space-y-3"
					onsubmit={(event) => {
						event.preventDefault();
						send("accept");
					}}
				>
					{#each fields as field (field.name)}
						{@const id = `elicit-${request.elicitationId}-${field.name}`}
						<div>
							{#if field.kind === "boolean"}
								<label class="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
									<input
										{id}
										type="checkbox"
										checked={isChecked(field.name)}
										onchange={(event) => set(field.name, event.currentTarget.checked)}
										disabled={!open}
										class="mt-0.5"
									/>
									<span>{field.title ?? field.name}</span>
								</label>
							{:else}
								{@const grouped = field.kind === "select" && field.multiple}
								<svelte:element
									this={grouped ? "span" : "label"}
									id={`${id}-label`}
									for={grouped ? undefined : id}
									class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
								>
									{field.title ?? field.name}
									{#if field.required}<span class="text-red-500">*</span>{/if}
								</svelte:element>
							{/if}

							{#if field.description}
								<p class="mb-1 text-xs text-gray-500 dark:text-gray-400">{field.description}</p>
							{/if}

							{#if field.kind === "string"}
								<input
									{id}
									type={field.format === "email"
										? "email"
										: field.format === "date"
											? "date"
											: field.format === "date-time"
												? "datetime-local"
												: field.format === "uri"
													? "url"
													: "text"}
									value={textValue(field.name)}
									oninput={(event) => set(field.name, event.currentTarget.value)}
									required={field.required}
									minlength={field.minLength}
									maxlength={field.maxLength}
									disabled={!open}
									class={inputClass}
								/>
							{:else if field.kind === "number"}
								<input
									{id}
									type="number"
									value={textValue(field.name)}
									oninput={(event) => set(field.name, event.currentTarget.value)}
									required={field.required}
									min={field.minimum}
									max={field.maximum}
									step={field.integer ? 1 : "any"}
									disabled={!open}
									class={inputClass}
								/>
							{:else if field.kind === "select" && !field.multiple}
								<select
									{id}
									value={textValue(field.name)}
									onchange={(event) => set(field.name, event.currentTarget.value)}
									required={field.required}
									disabled={!open}
									class={inputClass}
								>
									<option value="" disabled={field.required}>Choose…</option>
									{#each field.options as option (option.value)}
										<option value={option.value}>{option.label}</option>
									{/each}
								</select>
							{:else if field.kind === "select"}
								{@const atLimit =
									field.maxItems !== undefined && pickedCount(field.name) >= field.maxItems}
								<div class="space-y-1" role="group" aria-labelledby={`${id}-label`}>
									{#each field.options as option (option.value)}
										{@const picked = isPicked(field.name, option.value)}
										<label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
											<input
												type="checkbox"
												value={option.value}
												checked={picked}
												onchange={(event) =>
													toggleOption(field.name, option.value, event.currentTarget.checked)}
												disabled={!open || (atLimit && !picked)}
											/>
											{option.label}
										</label>
									{/each}
									{#if field.maxItems !== undefined}
										<p class="text-xs text-gray-500 dark:text-gray-400">
											Choose up to {field.maxItems}{field.minItems
												? `, at least ${field.minItems}`
												: ""}.
										</p>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</form>
			{/if}

			{#if error}
				<p class="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
			{/if}

			{#if open}
				<div class="mt-4 flex flex-wrap gap-2">
					{#if request.mode === "form" && fields.length > 0}
						<button
							type="submit"
							form={formId}
							disabled={submitting}
							class="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white"
						>
							Send
						</button>
					{:else}
						<button
							type="button"
							onclick={() => send("accept")}
							disabled={submitting}
							class="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white"
						>
							I've done this
						</button>
					{/if}
					<button
						type="button"
						onclick={() => send("decline")}
						disabled={submitting}
						class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
					>
						Decline
					</button>
					<!-- Distinct from Decline: the spec requires a way to dismiss without choosing. -->
					<button
						type="button"
						onclick={() => send("cancel")}
						disabled={submitting}
						class="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
					>
						Dismiss
					</button>
				</div>
			{/if}
		</div>
	</BlockWrapper>
{/if}
