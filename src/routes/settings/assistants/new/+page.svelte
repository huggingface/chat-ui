<script lang="ts">
	import { enhance } from "$app/forms";
	import { useSettingsStore } from "$lib/stores/settings";
	import { onMount } from "svelte";
	import type { ActionData, PageData } from "./$types";
	import type { readAndCompressImage } from "browser-image-resizer";
	import { base } from "$app/paths";

	export let data: PageData;
	export let form: ActionData;

	const settings = useSettingsStore();

	let compress: typeof readAndCompressImage | null = null;

	onMount(async () => {
		const module = await import("browser-image-resizer");
		compress = module.readAndCompressImage;
	});

	let inputMessage1: string;
	let inputMessage2: string;
	let inputMessage3: string;
	let inputMessage4: string;
</script>

<form
	method="POST"
	class="h-full"
	enctype="multipart/form-data"
	use:enhance={async ({ formData }) => {
		const avatar = formData.get("avatar");

		if (avatar && typeof avatar !== "string" && avatar.size > 0 && compress) {
			await compress(avatar, {
				maxWidth: 500,
				maxHeight: 500,
				quality: 1,
			}).then((resizedImage) => {
				formData.set("avatar", resizedImage);
			});
		}
	}}
>
	<h2 class="mb-8 text-xl font-semibold">Create new assistant</h2>
	<div class="grid grid-cols-2 gap-2">
		<div class="flex flex-col gap-4 px-2">
			<label class="truncate">
				<span class="block text-sm font-semibold">Avatar</span>
				<input type="file" accept="image/*" name="avatar" class="crop mx-auto" />
			</label>

			<label>
				<span class="text-sm font-semibold">Name</span>
				<input
					name="name"
					class=" w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
					placeholder="My awesome model"
				/>
			</label>

			<label>
				<span class="text-sm font-semibold">Description</span>
				<textarea
					name="description"
					class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
					placeholder="He knows everything about python"
				/>
			</label>

			<label>
				<span class="text-sm font-semibold">Model</span>
				<select name="modelId" class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2">
					{#each data.models as model}
						<option value={model.id} selected={$settings.activeModel === model.id}
							>{model.displayName}</option
						>
					{/each}
				</select>
			</label>

			<label>
				<span class="text-sm font-semibold">Start messages</span>
				<div class="flex max-h-32 flex-col gap-2 overflow-y-scroll">
					<input
						name="exampleInput1"
						bind:value={inputMessage1}
						class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
					/>
					{#if !!inputMessage1 || !!inputMessage2}
						<input
							name="exampleInput2"
							bind:value={inputMessage2}
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						/>
					{/if}
					{#if !!inputMessage2 || !!inputMessage3}
						<input
							name="exampleInput3"
							bind:value={inputMessage3}
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						/>
					{/if}
					{#if !!inputMessage3 || !!inputMessage4}
						<input
							name="exampleInput4"
							bind:value={inputMessage4}
							class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
						/>
					{/if}
				</div>
			</label>
		</div>

		<div class="flex flex-col gap-4 px-2">
			<label class="h-full">
				Instructions (system prompt)
				<h6 class="pb-3 text-sm font-light text-gray-700">
					Lorem ipsum dolor sit amet consectetur. Hendrerit ullamcorper malesuada dignissim egestas.
					Iaculis ultrices felis facilisis ullamcorper mi egestas. In et ultrices ut nulla semper.
				</h6>
				<textarea
					name="preprompt"
					class="h-64 w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2 text-sm"
					placeholder="You'll act as..."
				/>
			</label>
		</div>
	</div>

	{#if form?.error}
		<p class="text-red-500">{JSON.stringify(form.errors)}</p>
	{/if}

	<div class="mt-5 flex flex-row justify-around">
		<a href="{base}/settings" class="rounded-full bg-gray-200 px-8 py-2 font-semibold text-gray-600"
			>Cancel</a
		>

		<button type="submit" class="rounded-full bg-black px-20 py-2 font-semibold text-white"
			>Create</button
		>
	</div>
</form>
