<script lang="ts">
	import { base } from "$app/paths";
	import { clickOutside } from "$lib/actions/clickOutside";
	import { browser } from "$app/environment";
	import { afterNavigate, goto } from "$app/navigation";
	export let data;

	let previousPage: string = base;

	afterNavigate(({ from }) => {
		if (!from?.url.pathname.includes("settings")) {
			previousPage = from?.url.pathname || previousPage;
		}
		console.log(previousPage);
	});
</script>

<dialog
	class="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-8 backdrop-blur-sm dark:bg-black/50"
	use:clickOutside={() => {
		if (browser) window;
		goto(previousPage);
	}}
>
	<div
		class="max-h-[90dvh] overflow-y-auto overflow-x-hidden rounded-2xl bg-white shadow-2xl outline-none sm:-mt-10"
	>
		<div class="grid h-full w-full grid-cols-4 gap-4">
			<div class="flex h-full w-full flex-col gap-4 bg-gray-200 p-4 pl-8 pt-8">
				<h2 class="text-xl font-bold">Settings</h2>
				<h3 class="text-sm font-light">Models</h3>
				<div class="flex flex-col gap-2">
					{#each data.models as model}
						<div class="flex flex-row items-center gap-2">
							<a href="{base}/settings/{model.id}" class="btn btn-primary">Edit</a>
							<span class="text-sm font-semibold">{model.displayName}</span>
						</div>
					{/each}
					<a href="{base}/settings" class="btn btn-primary">Settings</a>
				</div>
			</div>
			<div class="col-span-3">
				<slot />
			</div>
		</div>
	</div>
</dialog>
