<script lang="ts">
	import { enhance, applyAction } from "$app/forms";
	import { useSettingsStore } from "$lib/stores/settings";
	import { onMount } from "svelte";
	import type { ActionData, PageData } from "./$types";
	import type { readAndCompressImage } from "browser-image-resizer";
	import { base } from "$app/paths";

	import CarbonPen from "~icons/carbon/pen";
	import IconLoading from "$lib/components/icons/IconLoading.svelte";

	export let data: PageData;
	export let form: ActionData;

	let files: FileList | null = null;

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

	function getError(field: string, returnForm: ActionData) {
		return returnForm?.errors.find((error) => error.field === field)?.message ?? "";
	}

	let loading = false;
</script>

<form
	method="POST"
	class="h-full w-full overflow-x-clip"
	enctype="multipart/form-data"
	use:enhance={async ({ formData }) => {
		loading = true;
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

		return async ({ result }) => {
			loading = false;
			await applyAction(result);
		};
	}}
>
	<h2 class="text-xl font-semibold">Create new assistant</h2>
	<p class="mb-8 text-sm text-gray-500">
		Assistants are public, and can be accessed by anyone with the link.
	</p>
	<div class="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
		<div class="flex flex-col gap-4 px-2">
			<label class="truncate">
				<span class="block text-sm font-semibold">Avatar</span>
				<input
					type="file"
					accept="image/*"
					name="avatar"
					class="invisible z-10 block h-0 w-0"
					bind:files
				/>
				{#if files && files[0]}
					<div class="group relative mx-auto h-12 w-12">
						<img
							src={URL.createObjectURL(files[0])}
							alt="avatar"
							class="crop mx-auto h-12 w-12 cursor-pointer rounded-full"
						/>
						<div
							class="invisible absolute bottom-0 h-12 w-12 rounded-full bg-black bg-opacity-50 p-1 group-hover:visible hover:visible"
						>
							<CarbonPen class="mx-auto my-auto h-full cursor-pointer text-center text-white" />
						</div>
					</div>
					<button
						type="button"
						on:click={(e) => {
							e.stopPropagation();
							files = null;
						}}
						class="mx-auto w-full text-center text-xs text-gray-600"
					>
						Reset
					</button>
				{:else}
					<span class="cursor-pointer text-xs text-gray-500 hover:underline">Click to upload</span>
				{/if}
				<p class="text-xs text-red-500">{getError("avatar", form)}</p>
				{#if !files || !files[0]}
					<label class="text-xs text-gray-500">
						<input type="checkbox" name="generateAvatar" class="text-xs text-gray-500" />
						Generate avatar using a text-to-image model.
					</label>
				{/if}
			</label>

			<label>
				<span class="text-sm font-semibold">Name</span>
				<input
					name="name"
					class=" w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
					placeholder="My awesome model"
				/>
				<p class="text-xs text-red-500">{getError("name", form)}</p>
			</label>

			<label>
				<span class="text-sm font-semibold">Description</span>
				<textarea
					name="description"
					class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2"
					placeholder="He knows everything about python"
				/>
				<p class="text-xs text-red-500">{getError("description", form)}</p>
			</label>

			<label>
				<span class="text-sm font-semibold">Model</span>
				<select name="modelId" class="w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2">
					{#each data.models as model}
						<option value={model.id} selected={$settings.activeModel === model.id}
							>{model.displayName}</option
						>
					{/each}
					<p class="text-xs text-red-500">{getError("modelId", form)}</p>
				</select>
			</label>

			<label>
				<span class="text-sm font-semibold">Start messages</span>
				<div class="flex flex-col gap-2 md:max-h-32 md:overflow-y-scroll">
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
				<p class="text-xs text-red-500">{getError("inputMessage1", form)}</p>
			</label>
		</div>

		<div class="flex flex-col gap-4 px-2">
			<label class="h-full">
				<span class="text-sm font-semibold"> Instructions (system prompt) </span>

				<textarea
					name="preprompt"
					class="h-64 w-full rounded-lg border-2 border-gray-200 bg-gray-100 p-2 text-sm"
					placeholder="You'll act as..."
				/>

				<p class="text-xs text-red-500">{getError("preprompt", form)}</p>
			</label>
		</div>
	</div>

	<div class="mx-4 mt-5 flex w-full flex-row justify-around gap-2">
		<a href="{base}/settings" class="rounded-full bg-gray-200 px-8 py-2 font-semibold text-gray-600"
			>Cancel</a
		>

		<button
			type="submit"
			disabled={loading}
			aria-disabled={loading}
			class="rounded-full bg-black px-8 py-2 font-semibold md:px-20"
			class:bg-gray-200={loading}
			class:text-gray-600={loading}
			class:text-white={!loading}
		>
			Create
			{#if loading}
				<IconLoading classNames="ml-2 h-min" />
			{/if}
		</button>
	</div>
</form>
