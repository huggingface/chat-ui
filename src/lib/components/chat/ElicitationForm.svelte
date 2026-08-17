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
	import BlockWrapper from "./BlockWrapper.svelte";

	interface Props {
		conversationId: string;
		request: ElicitationRequestPayload;
		/** Epoch ms. */
		expiresAt: number;
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
	let submitting = $state(false);
	let error = $state<string | null>(null);
	/** Settles the form without waiting for the run to echo the outcome back. */
	let submitted = $state<ElicitationAction | null>(null);

	let now = $state(Date.now());
	let outcome = $derived(resolved?.action ?? submitted);
	let expired = $derived(!outcome && now >= expiresAt);
	let open = $derived(!outcome && !expired);

	$effect(() => {
		if (!open) return;
		const period = expiresAt - now > 120_000 ? 30_000 : 1_000;
		const timer = setInterval(() => (now = Date.now()), period);
		return () => clearInterval(timer);
	});

	let timeLeft = $derived.by(() => {
		const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
		if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h left`;
		if (seconds >= 120) return `${Math.floor(seconds / 60)}m left`;
		return `${seconds}s left`;
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

	const isPicked = (name: string, option: string): boolean => {
		const value = values[name];
		return Array.isArray(value) && value.includes(option);
	};

	function set(name: string, value: ElicitationValue) {
		values = { ...values, [name]: value };
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
			if (field.kind === "number") {
				const parsed = typeof value === "number" ? value : Number(value);
				if (Number.isFinite(parsed)) out[field.name] = parsed;
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
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				error = typeof body?.message === "string" ? body.message : "Could not send your answer.";
				return;
			}
			submitted = action;
		} catch {
			error = "Could not send your answer.";
		} finally {
			submitting = false;
		}
	}

	// Submitting through the form is what runs the browser's own field validation.
	const formId = $derived(`elicit-form-${request.elicitationId}`);

	const inputClass =
		"w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white";
</script>

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
							<label
								for={id}
								class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
							>
								{field.title ?? field.name}
								{#if field.required}<span class="text-red-500">*</span>{/if}
							</label>
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
							<div class="space-y-1">
								{#each field.options as option (option.value)}
									<label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
										<input
											type="checkbox"
											value={option.value}
											checked={isPicked(field.name, option.value)}
											onchange={(event) =>
												toggleOption(field.name, option.value, event.currentTarget.checked)}
											disabled={!open}
										/>
										{option.label}
									</label>
								{/each}
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
			</div>
		{:else}
			<p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
				{#if outcome === "accept"}
					Sent.
				{:else if outcome === "decline"}
					Declined.
				{:else if resolved?.resolution === "aborted"}
					Cancelled when the response was stopped.
				{:else if resolved?.resolution === "withdrawn"}
					{request.server} stopped waiting for an answer.
				{:else if expired || resolved?.resolution === "expired"}
					This request expired without an answer.
				{:else}
					Cancelled.
				{/if}
			</p>
		{/if}
	</div>
</BlockWrapper>
