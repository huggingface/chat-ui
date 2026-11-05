<script lang="ts">
	import { page } from "$app/state";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import { subscribeToTheme } from "$lib/switchTheme";
	import Modal from "$lib/components/Modal.svelte";
	import SidePane from "./SidePane.svelte";
	import PaneItemNav from "./PaneItemNav.svelte";

	import type { PaneItem } from "$lib/utils/paneItems";
	import { TRACKIO_FRAME_SANDBOX } from "$lib/utils/trackio";
	import { workflowTokenHandler } from "$lib/utils/workflowSpace";

	import CarbonFlow from "~icons/carbon/flow";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonClose from "~icons/carbon/close";
	import CarbonLaunch from "~icons/carbon/launch";
	import CarbonRenew from "~icons/carbon/renew";

	interface Props {
		items: PaneItem[];
	}

	let { items }: Props = $props();

	let workflow = $derived(sidePane.workflow);
	let present = $derived(
		!!workflow && items.some((item) => item.kind === "workflow" && item.url === workflow?.url)
	);

	// Debounced: the message list has transient gaps while a generation is refetched.
	$effect(() => {
		if (sidePane.open && sidePane.view === "workflow" && workflow && !present) {
			const timer = setTimeout(() => sidePane.close(), 300);
			return () => clearTimeout(timer);
		}
	});

	let isDark = $state(false);
	$effect(() => subscribeToTheme((theme) => (isDark = theme.isDark)));

	// `__theme` is read at page load, so a theme toggle reloads the frame.
	let frameUrl = $derived.by(() => {
		if (!workflow) return undefined;
		try {
			const url = new URL(workflow.url);
			url.searchParams.set("__theme", isDark ? "dark" : "light");
			return url.toString();
		} catch {
			return workflow.url;
		}
	});

	let reloadNonce = $state(0);

	let frame = $state<HTMLIFrameElement>();
	let origin = $derived.by(() => {
		try {
			return workflow ? new URL(workflow.url).origin : undefined;
		} catch {
			return undefined;
		}
	});

	let declined = $state(false);

	let asking = $state<{ spaceId: string; answer: (yes: boolean) => void } | null>(null);

	async function consent(spaceId: string): Promise<boolean> {
		const key = `workflow-inference-consent:${spaceId}`;
		try {
			if (localStorage.getItem(key) === "yes") return true;
		} catch {
			// storage blocked: ask every time
		}
		const yes = await new Promise<boolean>((answer) => (asking = { spaceId, answer }));
		asking = null;
		if (!yes) {
			declined = true;
			return false;
		}
		try {
			localStorage.setItem(key, "yes");
		} catch {
			// remembered for this visit only
		}
		return true;
	}

	// Before the frame loads: gradio sends its ZeroGPU handshake once, on startup.
	$effect(() => {
		if (!workflow || !origin) return;
		const spaceId = workflow.spaceId;
		declined = false;
		const onMessage = workflowTokenHandler({
			frame: () => frame?.contentWindow,
			origin,
			spaceId,
			viewer: page.data.user?.username,
			consent: () => consent(spaceId),
		});
		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			asking = null;
		};
	});
</script>

{#if sidePane.open && sidePane.view === "workflow" && workflow}
	<SidePane label="Workflow">
		{#snippet children(resizing)}
			<header
				class="@container relative z-10 flex h-12 flex-none items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
			>
				<PaneItemNav {items} />
				<div class="flex min-w-0 flex-1 items-baseline gap-2">
					<h2 class="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-200">
						Workflow
					</h2>
					<span
						class="truncate font-mono text-xs text-gray-400 @max-[380px]:hidden dark:text-gray-500"
					>
						{workflow.label}
					</span>
				</div>

				<div class="flex flex-none items-center gap-0.5 text-gray-500 dark:text-gray-400">
					<button
						type="button"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Reload the workflow"
						onclick={() => (reloadNonce += 1)}
					>
						<CarbonRenew />
					</button>
					<a
						href={workflow.url}
						target="_blank"
						rel="noopener noreferrer"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Open the workflow in a new tab to sign in and run it"
					>
						<CarbonLaunch />
					</a>
					<button
						type="button"
						class="ml-0.5 btn rounded-md p-1 text-base hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Close panel (Esc)"
						onclick={() => sidePane.close()}
					>
						<CarbonCloseLarge />
					</button>
				</div>
			</header>

			{#if declined}
				<div
					class="flex flex-none items-start gap-2 border-b border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
				>
					<p class="flex-1">
						Model runs here won't use your account. Sign in inside the workflow, or open it in a new
						tab to run it.
					</p>
					<button
						type="button"
						class="flex-none hover:text-gray-700 dark:hover:text-gray-200"
						onclick={() => (declined = false)}
						aria-label="Dismiss"
					>
						<CarbonClose />
					</button>
				</div>
			{/if}
			<div class="relative min-h-0 flex-1 bg-white dark:bg-gray-900">
				<div
					class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
					role="status"
					aria-live="polite"
				>
					<span
						class="workflow-pulse flex size-11 items-center justify-center rounded-xl bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
					>
						<CarbonFlow class="text-xl" />
					</span>
					<div class="flex flex-col gap-1">
						<p class="text-sm font-medium text-gray-600 dark:text-gray-300">
							Starting the workflow
						</p>
						<p class="max-w-xs text-xs text-gray-400 dark:text-gray-500">
							The Space takes a minute or two to build. The canvas appears as soon as it is up.
						</p>
					</div>
					<span class="font-mono text-xxs text-gray-300 dark:text-gray-600">{workflow.label}</span>
				</div>
				{#key `${frameUrl}:${reloadNonce}`}
					<iframe
						title="Workflow"
						class="relative h-full w-full {resizing ? 'pointer-events-none' : ''}"
						src={frameUrl}
						bind:this={frame}
						sandbox={TRACKIO_FRAME_SANDBOX}
						allowfullscreen
						referrerpolicy="no-referrer"
					></iframe>
				{/key}
			</div>
		{/snippet}
	</SidePane>
{/if}

{#if asking}
	{@const { spaceId, answer } = asking}
	<Modal onclose={() => answer(false)} width="w-[90dvh] md:w-[480px]" labelledBy="workflow-consent">
		<div class="flex w-full flex-col gap-5 p-6">
			<div class="flex items-start justify-between">
				<h2 id="workflow-consent" class="text-xl font-semibold text-gray-800 dark:text-gray-200">
					Run models with your account?
				</h2>
				<button
					type="button"
					class="group outline-hidden"
					onclick={() => answer(false)}
					aria-label="Close"
				>
					<CarbonClose
						class="size-5 text-gray-700 group-hover:text-gray-500 dark:text-gray-300 dark:group-hover:text-gray-400"
					/>
				</button>
			</div>
			<p class="text-sm text-gray-600 dark:text-gray-400">
				This workflow wants to call models with your Hugging Face account. Each run uses your
				Inference Providers credits. Only continue if you trust the Space.
			</p>
			<p
				class="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 font-mono text-xs break-all text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
			>
				<span class="font-semibold text-gray-800 dark:text-gray-200">{spaceId.split("/")[0]}</span
				>/{spaceId.split("/")[1]}
			</p>
			<div class="flex items-center justify-end gap-2">
				<button
					type="button"
					class="inline-flex items-center rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 shadow-sm outline-hidden hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
					onclick={() => answer(false)}
				>
					Cancel
				</button>
				<button
					type="button"
					class="inline-flex items-center rounded-xl border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:outline-hidden dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white dark:focus:ring-offset-gray-800"
					onclick={() => answer(true)}
				>
					Allow
				</button>
			</div>
		</div>
	</Modal>
{/if}

<style>
	.workflow-pulse {
		animation: workflow-pulse 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
	}

	@keyframes workflow-pulse {
		0%,
		100% {
			opacity: 0.55;
			transform: scale(0.96);
		}
		50% {
			opacity: 1;
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.workflow-pulse {
			animation: none;
			opacity: 0.8;
		}
	}
</style>
