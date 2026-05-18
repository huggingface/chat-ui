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
		"Drop one proof post today with a clear CTA.",
		"Reply to 10 high-intent comments with one offer angle.",
		"Publish a 20-second reel that amplifies your core hook.",
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
	let sessions = $derived(data?.stats?.sessionsTracked ?? 128400);
	let profileReady = $derived(data?.stats?.profileReady ?? true);
	let growthScore = $derived(data?.stats?.growthScore ?? 92);
	let handle = $derived(user?.email ? `@${user.email.split("@")[0]}` : "@thehoodninja");
</script>

<svelte:head>
	<title>NIKNO Creator Dashboard</title>
	<meta name="description" content="Creator profile and growth command center." />
</svelte:head>

<section class="min-h-full overflow-y-auto bg-[#070612] text-white">
	<div class="mx-auto w-full max-w-3xl px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
		<div class="overflow-hidden rounded-[2.2rem] border border-[#2a2440] bg-[#090817] shadow-[0_25px_80px_rgba(92,40,195,0.35)]">
			<div class="relative p-6 sm:p-8">
				<div class="absolute right-5 top-5 h-16 w-16 rounded-full border-2 border-[#2dfad0] bg-[radial-gradient(circle_at_30%_20%,#76fadb,#0f7267)]"></div>
				<h1 class="inline-block rounded-xl bg-[radial-gradient(circle_at_15%_50%,rgba(255,0,136,0.35),transparent_62%)] px-2 py-1 text-4xl font-black tracking-tight sm:text-5xl">
					THE HOOD NINJA
				</h1>
				<div class="mt-3 flex flex-wrap items-center gap-3">
					<p class="text-2xl text-white/70">{handle}</p>
					<span class="rounded-full bg-[#3bf2cf] px-4 py-1 text-sm font-black text-[#081b19]">VERIFIED</span>
				</div>
				<p class="mt-6 max-w-2xl text-xl leading-9 text-white/80">
					Hood by night. Ninja by blood. Multiverse runner by choice. I move in silence but leave
					lightning in my wake.
				</p>
				<p class="mt-4 text-3xl text-[#ff47b8]">#StayHooded #CosmicTreadmill</p>

				<div class="mt-8 grid grid-cols-3 gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-center">
					<div>
						<p class="text-3xl font-black">{sessions.toLocaleString()}</p>
						<p class="text-sm text-white/60">Followers</p>
					</div>
					<div>
						<p class="text-3xl font-black">892</p>
						<p class="text-sm text-white/60">Following</p>
					</div>
					<div>
						<p class="text-3xl font-black">{growthScore}%</p>
						<p class="text-sm text-white/60">Growth</p>
					</div>
				</div>

				<div class="mt-6 grid gap-3 sm:grid-cols-2">
					<a href="/" class="inline-flex min-h-14 items-center justify-center rounded-2xl bg-white px-6 text-lg font-black text-black transition hover:opacity-95">Follow</a>
					<a href="/pricing" class="inline-flex min-h-14 items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-6 text-lg font-black transition hover:bg-white/10">Upgrade</a>
				</div>
			</div>
		</div>

		<div class="mt-5 rounded-[2rem] border border-[#2a2440] bg-[#0d0b19] p-6 sm:p-8">
			<h2 class="text-3xl font-black">Today&apos;s mission</h2>
			<div class="mt-5 space-y-3">
				{#if loading}
					<div class="h-14 animate-pulse rounded-2xl bg-white/[0.07]"></div>
					<div class="h-14 animate-pulse rounded-2xl bg-white/[0.07]"></div>
				{:else}
					{#each insights as insight, index}
						<div class="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
							<span class="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7c4dff] text-sm font-black">{index + 1}</span>
							<p class="text-base text-white/80">{insight}</p>
						</div>
					{/each}
				{/if}
			</div>
			<p class="mt-5 text-sm text-white/55">Profile status: {profileReady ? "Ready" : "Setup needed"}</p>
		</div>
	</div>
</section>
