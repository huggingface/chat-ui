<script lang="ts">
	type Plan = "pro" | "elite";

	async function checkout(plan: Plan) {
		const res = await fetch("/api/platform/payments/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ planId: plan }),
		});

		const data = (await res.json()) as { checkoutUrl?: string };

		if (data.checkoutUrl) {
			window.location.href = data.checkoutUrl;
		} else {
			alert("Payment not configured");
		}
	}
</script>

<h1 class="mb-6 text-3xl font-bold">Pricing</h1>

<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
	<div class="rounded border p-4">
		<h2 class="text-xl">Free</h2>
		<p>$0</p>
	</div>

	<div class="rounded border p-4">
		<h2 class="text-xl">Pro</h2>
		<p>$29</p>
		<button type="button" onclick={() => checkout("pro")}>Upgrade</button>
	</div>

	<div class="rounded border p-4">
		<h2 class="text-xl">Elite</h2>
		<p>$99</p>
		<button type="button" onclick={() => checkout("elite")}>Upgrade</button>
	</div>
</div>
