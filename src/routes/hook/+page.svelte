<script lang="ts">
	type GrowthPlanResult = {
		plan: {
			positioning: string;
			sevenDayPlan: string[];
		};
	};

	let result = $state<GrowthPlanResult | null>(null);

	async function generate() {
		const res = await fetch("http://localhost:3002/hook/growth-plan", {
			method: "POST",
		});

		result = (await res.json()) as GrowthPlanResult;
	}
</script>

<h1 class="mb-4 text-3xl font-bold">Get Your Creator Growth Plan</h1>
<button onclick={generate} class="bg-black px-4 py-2 text-white">Generate Plan</button>

{#if result}
	<div class="mt-6">
		<h2 class="text-xl">Positioning</h2>
		<p>{result.plan.positioning}</p>

		<h2 class="mt-4 text-xl">7 Day Plan</h2>
		<ul>
			{#each result.plan.sevenDayPlan as step}
				<li>{step}</li>
			{/each}
		</ul>
	</div>
{/if}
