<script lang="ts">
	import { onMount } from "svelte";

	type EliteDashboardData = {
		user?: { planId?: string };
		stats?: { sessionsTracked?: number; profileReady?: boolean };
		insights?: string[];
	};

	let data = $state<EliteDashboardData | null>(null);

	onMount(async () => {
		const userId = localStorage.getItem("userId");
		if (!userId) return;

		try {
			const res = await fetch(`http://localhost:3002/creator/${userId}`);
			if (res.ok) {
				data = (await res.json()) as EliteDashboardData;
			}
		} catch (err) {
			console.error("Unable to load elite dashboard", err);
		}
	});
</script>

<h1 class="mb-4 text-2xl font-bold">Elite Dashboard</h1>

{#if data}
	<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
		<div class="rounded bg-white p-4 shadow dark:bg-gray-800">
			<h2>Plan</h2>
			<p>{data.user?.planId ?? "Elite"}</p>
		</div>

		<div class="rounded bg-white p-4 shadow dark:bg-gray-800">
			<h2>Sessions</h2>
			<p>{data.stats?.sessionsTracked ?? 0}</p>
		</div>

		<div class="rounded bg-white p-4 shadow dark:bg-gray-800">
			<h2>Status</h2>
			<p>{data.stats?.profileReady ? "Ready" : "Incomplete"}</p>
		</div>
	</div>

	{#if data.insights?.length}
		<h2 class="mt-6 text-xl">Insights</h2>
		<ul>
			{#each data.insights as insight}
				<li>{insight}</li>
			{/each}
		</ul>
	{/if}
{/if}
