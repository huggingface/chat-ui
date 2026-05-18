<script lang="ts">
	import { onMount } from "svelte";

	type DashboardUser = {
		email?: string;
		planId?: string;
	};

	type DashboardData = {
		insights?: string[];
		stats?: {
			sessionsTracked?: number;
			profileReady?: boolean;
			growthScore?: number;
		};
	};

	let user = $state<DashboardUser | null>(null);
	let data = $state<DashboardData | null>(null);
	let loading = $state(true);

	const fallbackInsights = [
		"Package your next offer around one clear creator outcome.",
		"Publish one proof-driven post before starting the next campaign.",
		"Move warm leads into a simple follow-up sequence within 24 hours.",
	];

	onMount(async () => {
		const token = localStorage.getItem("token");
		const userId = localStorage.getItem("userId");

		try {
			if (token) {
				const meRes = await fetch("/api/platform/auth/me", {
					headers: { authorization: `Bearer ${token}` },
				});

				if (meRes.ok) {
					const me = (await meRes.json()) as { user?: DashboardUser };
					user = me.user ?? null;
				}
			}

			if (userId) {
				const dashRes = await fetch(`/api/platform/dashboard/${userId}`);
				if (dashRes.ok) {
					data = (await dashRes.json()) as DashboardData;
				}
			}
		} catch (err) {
			console.error("Unable to load dashboard data", err);
		} finally {
			loading = false;
		}
	});

	let insights = $derived(data?.insights?.length ? data.insights : fallbackInsights);
	let plan = $derived(user?.planId ?? "Creator OS");
	let sessions = $derived(data?.stats?.sessionsTracked ?? 0);
	let profileReady = $derived(data?.stats?.profileReady ?? false);
	let growthScore = $derived(data?.stats?.growthScore ?? 74);
</script>

<svelte:head>
	<title>NIKNO Creator Dashboard</title>
	<meta
		name="description"
		content="NIKNO creator control deck for strategy, launches, and growth intelligence."
	/>
</svelte:head>

<section class="min-h-full overflow-y-auto bg-[#05030d] text-[#f6f1ff]">
	<div
		class="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-6 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 lg:px-8"
	>
		<div
			class="overflow-hidden rounded-[2rem] border border-white/10 bg-[#11101b]/95 shadow-2xl shadow-purple-950/30"
		>
			<div class="grid gap-0 lg:grid-cols-[1.05fr,0.95fr]">
				<div
					class="space-y-7 bg-[radial-gradient(circle_at_top_left,rgba(121,78,255,0.24),transparent_45%)] p-6 sm:p-8 lg:p-10"
				>
					<div>
						<p class="text-sm font-bold uppercase tracking-[0.36em] text-[#e8c879]">Control Deck</p>
						<h1 class="mt-5 max-w-2xl text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
							HooD NinJA
						</h1>
						<p class="text-white/68 mt-4 max-w-xl text-base leading-7 sm:text-lg">
							Run your creator business from one focused command center: strategy, content,
							monetization, and execution.
						</p>
					</div>

					<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
						<a
							href="/"
							class="inline-flex min-h-14 items-center justify-center rounded-2xl bg-[#7446ff] px-5 text-base font-black text-white shadow-lg shadow-purple-700/30 transition hover:-translate-y-0.5 hover:bg-[#8358ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8c879]"
						>
							New Chat
						</a>
						<button
							type="button"
							class="border-white/12 inline-flex min-h-14 items-center justify-center rounded-2xl border bg-white/[0.06] px-5 text-base font-black text-white transition hover:-translate-y-0.5 hover:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8c879]"
							onclick={() => location.reload()}
						>
							Refresh
						</button>
						<a
							href="/hook"
							class="border-white/12 inline-flex min-h-14 items-center justify-center rounded-2xl border bg-white/[0.06] px-5 text-base font-black text-white transition hover:-translate-y-0.5 hover:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e8c879]"
						>
							Console
						</a>
					</div>
				</div>

				<div class="border-t border-white/10 p-6 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
					<p class="text-white/42 text-sm font-bold uppercase tracking-[0.28em]">Status</p>
					<div class="mt-5 grid grid-cols-2 gap-3">
						<div class="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
							<p class="text-xs uppercase tracking-[0.24em] text-white/45">Plan</p>
							<p class="mt-3 text-2xl font-black">{plan}</p>
						</div>
						<div class="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
							<p class="text-xs uppercase tracking-[0.24em] text-white/45">Score</p>
							<p class="mt-3 text-2xl font-black">{growthScore}%</p>
						</div>
						<div class="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
							<p class="text-xs uppercase tracking-[0.24em] text-white/45">Sessions</p>
							<p class="mt-3 text-2xl font-black">{sessions}</p>
						</div>
						<div class="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
							<p class="text-xs uppercase tracking-[0.24em] text-white/45">Profile</p>
							<p class="mt-3 text-2xl font-black">{profileReady ? "Ready" : "Setup"}</p>
						</div>
					</div>
				</div>
			</div>
		</div>

		<div class="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
			<article
				class="rounded-[2rem] border border-white/10 bg-[#11101b]/95 p-6 shadow-xl shadow-purple-950/20 sm:p-8"
			>
				<p class="text-sm font-bold uppercase tracking-[0.32em] text-[#e8c879]">
					Creator Operating System
				</p>
				<h2 class="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Today's mission</h2>
				<div class="mt-6 space-y-3">
					{#if loading}
						<div class="h-16 animate-pulse rounded-2xl bg-white/[0.06]"></div>
						<div class="h-16 animate-pulse rounded-2xl bg-white/[0.06]"></div>
					{:else}
						{#each insights as insight, index}
							<div class="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
								<span
									class="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#7446ff] text-sm font-black text-white"
								>
									{index + 1}
								</span>
								<p class="text-sm leading-6 text-white/75 sm:text-base">{insight}</p>
							</div>
						{/each}
					{/if}
				</div>
			</article>

			<aside
				class="rounded-[2rem] border border-white/10 bg-[#11101b]/95 p-6 shadow-xl shadow-purple-950/20 sm:p-8"
			>
				<p class="text-sm font-bold uppercase tracking-[0.32em] text-[#e8c879]">Next Move</p>
				<h2 class="mt-4 text-3xl font-black tracking-tight">Launch loop</h2>
				<p class="text-white/68 mt-4 text-sm leading-6">
					Turn one strategic insight into a public post, one audience reply, and one offer
					touchpoint.
				</p>
				<a
					href="/pricing"
					class="mt-7 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#e8c879] px-5 text-base font-black text-[#130f1f] transition hover:-translate-y-0.5 hover:bg-[#f2d98f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
				>
					Upgrade System
				</a>
			</aside>
		</div>
	</div>
</section>
