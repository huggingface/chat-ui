<script lang="ts">
	import Modal from "./Modal.svelte";
	import { createEventDispatcher } from "svelte";

	interface Props {
		html: string;
	}

	let { html }: Props = $props();
	const dispatch = createEventDispatcher<{ close: void }>();

	function withBaseTarget(content: string): string {
		const baseTag = '<base target="_blank">';
		// Insert into <head> if present
		const headMatch = content.match(/<head[^>]*>/i);
		if (headMatch) {
			return content.replace(headMatch[0], headMatch[0] + baseTag);
		}

		// Otherwise, insert right after <html ...>
		const htmlTagMatch = content.match(/<html[^>]*>/i);
		if (htmlTagMatch) {
			return content.replace(htmlTagMatch[0], htmlTagMatch[0] + "\n<head>" + baseTag + "</head>");
		}

		// Otherwise, try after DOCTYPE
		const doctypeMatch = content.match(/<!doctype[^>]*>/i);
		if (doctypeMatch) {
			const idx = content.indexOf(doctypeMatch[0]) + doctypeMatch[0].length;
			return content.slice(0, idx) + "\n<head>" + baseTag + "</head>" + content.slice(idx);
		}

		// Fallback: prepend a head (parser will imply <html>)
		return "<head>" + baseTag + "</head>\n" + content;
	}

	let srcdoc = $derived(withBaseTarget(html));
</script>

<Modal width="max-w-[90dvw]" closeButton on:close={() => dispatch("close")}>
	<div class="p-4">
		<div class="h-[90dvh] w-[80dvw]">
			<iframe
				title="HTML Preview"
				class="h-full w-full rounded-lg border border-gray-200 dark:border-gray-700"
				sandbox="allow-scripts allow-popups"
				referrerpolicy="no-referrer"
				{srcdoc}
			/>
		</div>
	</div>
</Modal>
