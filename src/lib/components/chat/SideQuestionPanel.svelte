<script lang="ts">
	import { onDestroy } from "svelte";
	import { base } from "$app/paths";
	import IconX from "~icons/lucide/x";
	import MarkdownRenderer from "./MarkdownRenderer.svelte";
	import { isWebSideQuestion, webSideQuestion } from "$lib/utils/sideQuestion";

	interface Props {
		conversationId: string;
	}

	let { conversationId }: Props = $props();

	interface SideQuestion {
		id: number;
		question: string;
		answer: string;
		status: "loading" | "streaming" | "done" | "error";
		error?: string;
		controller: AbortController;
	}

	const MAX_ITEMS = 3;
	const GENERIC_ERROR = "Could not answer the side question.";
	const EMPTY_HINT = "Type your question after /btw, e.g. /btw which job is running?";

	let items: SideQuestion[] = $state([]);
	let nextId = 0;

	export function intercept(text: string): boolean {
		if (!isWebSideQuestion(text)) return false;
		const question = webSideQuestion(text);
		const id = nextId++;
		const controller = new AbortController();
		items.push(
			question
				? { id, question, answer: "", status: "loading", controller }
				: { id, question: "/btw", answer: "", status: "error", error: EMPTY_HINT, controller }
		);
		while (items.length > MAX_ITEMS) {
			items.shift()?.controller.abort();
		}
		if (question) void ask(id, question, controller);
		return true;
	}

	function update(id: number, patch: Partial<SideQuestion>) {
		const item = items.find((entry) => entry.id === id);
		if (item) Object.assign(item, patch);
	}

	function append(id: number, chunk: string) {
		const item = items.find((entry) => entry.id === id);
		if (!item) return;
		item.answer += chunk;
		item.status = "streaming";
	}

	async function ask(id: number, question: string, controller: AbortController) {
		try {
			const res = await fetch(`${base}/conversation/${conversationId}/btw`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ question }),
				signal: controller.signal,
			});
			if (!res.ok || !res.body) {
				const body = await res.json().catch(() => undefined);
				const message =
					typeof body?.message === "string" && body.message ? body.message : GENERIC_ERROR;
				update(id, { status: "error", error: message });
				return;
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = decoder.decode(value, { stream: true });
				if (chunk) append(id, chunk);
			}
			const tail = decoder.decode();
			if (tail) append(id, tail);
			update(id, { status: "done" });
		} catch {
			if (controller.signal.aborted) return;
			update(id, { status: "error", error: GENERIC_ERROR });
		}
	}

	function dismiss(id: number) {
		const index = items.findIndex((entry) => entry.id === id);
		if (index === -1) return;
		items[index].controller.abort();
		items.splice(index, 1);
	}

	onDestroy(() => {
		for (const item of items) item.controller.abort();
	});
</script>

{#if items.length > 0}
	<div class="mb-2 flex w-full max-w-4xl flex-col gap-1.5">
		{#each items as item (item.id)}
			<section
				aria-label="Side question"
				class="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-sm dark:border-gray-700 dark:bg-gray-800/60"
			>
				<div class="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
					<span
						class="shrink-0 rounded-md bg-gray-200/80 px-1.5 py-px text-[10px] font-semibold tracking-wide text-gray-500 uppercase dark:bg-gray-700 dark:text-gray-400"
					>
						btw
					</span>
					<span
						class="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300"
						title={item.question}
					>
						{item.question}
					</span>
					<button
						type="button"
						aria-label="Dismiss side question"
						class="flex size-6 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
						onclick={() => dismiss(item.id)}
					>
						<IconX class="size-3.5" />
					</button>
				</div>
				<div class="scrollbar-custom max-h-60 overflow-y-auto px-3 pb-2">
					{#if item.answer}
						<div
							class="prose prose-sm max-w-none text-sm text-gray-800 *:first:mt-0 *:last:mb-0 dark:text-gray-100 dark:prose-invert"
						>
							<MarkdownRenderer content={item.answer} loading={item.status === "streaming"} />
						</div>
					{:else if item.status === "loading"}
						<p class="animate-pulse text-gray-400 dark:text-gray-500">Thinking…</p>
					{:else if item.status === "done"}
						<p class="text-gray-400 dark:text-gray-500">No answer.</p>
					{/if}
					{#if item.status === "error"}
						<p class={["text-red-600 dark:text-red-400", item.answer && "mt-1"]}>
							{item.error ?? GENERIC_ERROR}
						</p>
					{/if}
				</div>
			</section>
		{/each}
		<p class="px-1 text-[11px] text-gray-400 dark:text-gray-500">
			Only you see this. The agent doesn't.
		</p>
	</div>
{/if}
