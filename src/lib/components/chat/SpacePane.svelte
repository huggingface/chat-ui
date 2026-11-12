<script lang="ts">
	import { untrack } from "svelte";
	import { base } from "$app/paths";
	import { sidePane } from "$lib/stores/sidePane.svelte";
	import { subscribeToTheme } from "$lib/switchTheme";
	import SidePane from "./SidePane.svelte";
	import PaneItemNav from "./PaneItemNav.svelte";

	import type { PaneItem } from "$lib/utils/paneItems";
	import { TRACKIO_FRAME_SANDBOX } from "$lib/utils/trackio";
	import {
		createConsoleReceiver,
		type ConsoleEntry,
		type ConsoleState,
		type FrameConsoleState,
	} from "$lib/utils/gradioConsole";

	import CarbonApplicationWeb from "~icons/carbon/application-web";
	import CarbonCloseLarge from "~icons/carbon/close-large";
	import CarbonLaunch from "~icons/carbon/launch";
	import CarbonRenew from "~icons/carbon/renew";

	interface Props {
		items: PaneItem[];
		/** forwards the frame console to this conversation, absent on a shared view */
		conversationId?: string;
	}

	let { items, conversationId }: Props = $props();

	let space = $derived(sidePane.space);
	let present = $derived(
		!!space && items.some((item) => item.kind === "space" && item.url === space?.url)
	);

	// debounced, the message list has transient gaps while a generation is refetched
	$effect(() => {
		if (sidePane.open && sidePane.view === "space" && space && !present) {
			const timer = setTimeout(() => sidePane.close(), 300);
			return () => clearTimeout(timer);
		}
	});

	let isDark = $state(false);
	$effect(() => subscribeToTheme((theme) => (isDark = theme.isDark)));

	let origin = $derived.by(() => {
		try {
			return space ? new URL(space.url).origin : undefined;
		} catch {
			return undefined;
		}
	});

	/** undefined while a private space token is fetched, null when there is none */
	let sign = $state<string | null | undefined>(null);
	// keyed on the private space id alone, so a new check of the same space keeps its frame
	let privateSpaceId = $derived(space?.private ? space.spaceId : undefined);
	$effect(() => {
		const spaceId = privateSpaceId;
		if (!spaceId || !conversationId) {
			sign = null;
			return;
		}
		sign = undefined;
		const abort = new AbortController();
		fetch(
			`${base}/conversation/${conversationId}/space-console?space=${encodeURIComponent(spaceId)}`,
			{ signal: abort.signal }
		)
			.then((res) => (res.ok ? res.json() : { sign: null }))
			.then((body: { sign?: unknown }) => {
				sign = typeof body.sign === "string" ? body.sign : null;
			})
			.catch(() => {
				if (!abort.signal.aborted) sign = null;
			});
		return () => abort.abort();
	});

	// __theme is read at page load, so a theme toggle reloads the frame
	let spaceUrl = $derived(space?.url);
	let frameUrl = $derived.by(() => {
		if (!spaceUrl || sign === undefined) return undefined;
		try {
			const url = new URL(spaceUrl);
			url.searchParams.set("__theme", isDark ? "dark" : "light");
			if (sign) url.searchParams.set("__sign", sign);
			return url.toString();
		} catch {
			return spaceUrl;
		}
	});

	let reloadNonce = $state(0);
	let frame = $state<HTMLIFrameElement>();
	let consoleState = $state<FrameConsoleState | null>(null);
	let forwarded = $state(0);

	/** the endpoint takes at most this many entries per post */
	const POST_MAX = 100;

	type Load = {
		id: string;
		conversationId: string;
		spaceId: string;
		/** the latest check_space call this load was asked to answer */
		checkId?: string;
		/** posts go out one at a time, the server drops a state update that arrives before its load */
		sent: Promise<unknown>;
	};
	let current: Load | undefined;

	function post(load: Load, body: Record<string, unknown>) {
		const send = () =>
			fetch(`${base}/conversation/${load.conversationId}/space-console`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ space: load.spaceId, load: load.id, ...body }),
			}).catch(() => {});
		load.sent = load.sent.then(send, send);
	}

	function postSnapshot(load: Load, snapshot: ConsoleState) {
		const chunks: ConsoleEntry[][] = [];
		for (let i = 0; i < snapshot.entries.length; i += POST_MAX) {
			chunks.push(snapshot.entries.slice(i, i + POST_MAX));
		}
		if (!chunks.length) chunks.push([]);
		chunks.forEach((entries, i) =>
			post(load, {
				session_id: snapshot.session_id,
				gradio_version: snapshot.gradio_version,
				dropped: snapshot.dropped,
				entries,
				// on the last post, so the whole reply is stored before the check reads it
				...(i === chunks.length - 1 && typeof snapshot.id === "string"
					? { answers: snapshot.id }
					: {}),
			})
		);
	}

	// only the owner forwards, a shared view shows the space and nothing more
	const receiver = $derived.by(() => {
		if (!conversationId || !origin) return undefined;
		return createConsoleReceiver({
			frame: () => frame?.contentWindow,
			origin,
			onState(state, reply) {
				consoleState = state;
				const load = current;
				if (!load || state === "connecting") return;
				post(load, {
					state,
					...(reply ? { session_id: reply.session_id, gradio_version: reply.gradio_version } : {}),
				});
			},
			onSnapshot(snapshot) {
				if (!current) return;
				forwarded += snapshot.entries.length;
				postSnapshot(current, snapshot);
			},
		});
	});

	$effect(() => {
		const active = receiver;
		if (!active) return;
		const onMessage = (event: MessageEvent) => active.handleMessage(event);
		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			active.dispose();
			current = undefined;
			consoleState = null;
		};
	});

	// a check of the space already loaded asks the page it shows, a frame still loading asks on load
	$effect(() => {
		const checkId = space?.checkId;
		const active = receiver;
		if (!checkId || !active) return;
		untrack(() => {
			const load = current;
			if (!load || load.checkId === checkId) return;
			load.checkId = checkId;
			post(load, { check: checkId });
			active.request(checkId);
		});
	});

	function onFrameLoad() {
		if (!receiver || !space || !conversationId) return;
		current = {
			id: crypto.randomUUID(),
			conversationId,
			spaceId: space.spaceId,
			...(space.checkId ? { checkId: space.checkId } : {}),
			sent: Promise.resolve(),
		};
		forwarded = 0;
		post(current, { state: "loading", ...(current.checkId ? { check: current.checkId } : {}) });
		receiver.load(current.checkId);
	}

	const STATUS: Record<FrameConsoleState, { label: string; title: string }> = {
		connecting: { label: "Console…", title: "Asking the Space for its browser console" },
		connected: {
			label: "Console",
			title: "ML Intern reads this Space's browser console while it is open here",
		},
		unsupported: {
			label: "No console",
			title: "This Space's frontend does not forward its browser console",
		},
	};
</script>

{#if sidePane.open && sidePane.view === "space" && space}
	<SidePane label="Space">
		{#snippet children(resizing)}
			<header
				class="@container relative z-10 flex h-12 flex-none items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
			>
				<PaneItemNav {items} />
				<div class="flex min-w-0 flex-1 items-baseline gap-2">
					<h2 class="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-200">
						Space
					</h2>
					<span
						class="truncate font-mono text-xs text-gray-400 @max-[380px]:hidden dark:text-gray-500"
					>
						{space.label}
					</span>
				</div>

				<div class="flex flex-none items-center gap-0.5 text-gray-500 dark:text-gray-400">
					{#if consoleState}
						<span
							class="mr-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs"
							title={STATUS[consoleState].title}
							data-console-state={consoleState}
						>
							<span
								class="size-1.5 rounded-full {consoleState === 'connected'
									? 'bg-green-500'
									: consoleState === 'connecting'
										? 'bg-gray-300 dark:bg-gray-600'
										: 'bg-gray-400 dark:bg-gray-500'}"
							></span>
							<span class="@max-[420px]:hidden">{STATUS[consoleState].label}</span>
							{#if consoleState === "connected" && forwarded}
								<span class="font-mono text-xxs tabular-nums">{forwarded}</span>
							{/if}
						</span>
					{/if}
					<button
						type="button"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Reload the Space"
						onclick={() => (reloadNonce += 1)}
					>
						<CarbonRenew />
					</button>
					<a
						href="https://huggingface.co/spaces/{space.spaceId}"
						target="_blank"
						rel="noopener noreferrer"
						class="btn rounded-md p-1.5 text-xs hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
						title="Open the Space in a new tab"
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

			<div class="relative min-h-0 flex-1 bg-white dark:bg-gray-900">
				<div
					class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
					role="status"
					aria-live="polite"
				>
					<span
						class="flex size-11 items-center justify-center rounded-xl bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
					>
						<CarbonApplicationWeb class="text-xl" />
					</span>
					<p class="text-sm font-medium text-gray-600 dark:text-gray-300">Loading the Space</p>
					<span class="font-mono text-xxs text-gray-300 dark:text-gray-600">{space.label}</span>
				</div>
				{#if frameUrl}
					{#key `${frameUrl}:${reloadNonce}`}
						<iframe
							title="Space {space.label}"
							class="relative h-full w-full {resizing ? 'pointer-events-none' : ''}"
							src={frameUrl}
							bind:this={frame}
							onload={onFrameLoad}
							sandbox={TRACKIO_FRAME_SANDBOX}
							allowfullscreen
							referrerpolicy="no-referrer"
						></iframe>
					{/key}
				{/if}
			</div>
		{/snippet}
	</SidePane>
{/if}
