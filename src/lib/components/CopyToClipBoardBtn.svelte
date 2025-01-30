<script lang="ts">
	import { onDestroy } from "svelte";

	import IconCopy from "./icons/IconCopy.svelte";
	import Tooltip from "./Tooltip.svelte";

	export let classNames = "";
	export let value: string;

	let isSuccess = false;
	let timeout: ReturnType<typeof setTimeout>;

	const unsecuredCopy = (text: string) => {
		//Old or insecure browsers

		const textArea = document.createElement("textarea");
		textArea.value = text;
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();
		document.execCommand("copy");
		document.body.removeChild(textArea);

		return Promise.resolve();
	};

	const copy = async (text: string) => {
		if (window.isSecureContext && navigator.clipboard) {
			return navigator.clipboard.writeText(text);
		}
		return unsecuredCopy(text);
	};

	const handleClick = async () => {
		try {
			await copy(value);

			isSuccess = true;
			if (timeout) {
				clearTimeout(timeout);
			}
			timeout = setTimeout(() => {
				isSuccess = false;
			}, 1000);
		} catch (err) {
			console.error(err);
		}
	};

	onDestroy(() => {
		if (timeout) {
			clearTimeout(timeout);
		}
	});
</script>

<button
	class={classNames}
	title={"Copy to clipboard"}
	type="button"
	on:click
	on:click={handleClick}
>
	<div class="relative">
		<slot>
			<IconCopy classNames="h-[1.14em] w-[1.14em]" />
		</slot>

		<Tooltip classNames={isSuccess ? "opacity-100" : "opacity-0"} />
	</div>
</button>
