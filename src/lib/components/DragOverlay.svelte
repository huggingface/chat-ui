<script lang="ts">
	import { dragState } from "$lib/stores/dragState";
</script>

{#if $dragState.isDragging && $dragState.draggedConv}
	<div
		class="pointer-events-none fixed z-[9999] max-w-[200px] truncate rounded-lg border border-blue-300 bg-white/95 px-3 py-1.5 text-sm font-medium text-gray-700 shadow-lg dark:border-blue-600 dark:bg-gray-800/95 dark:text-gray-200"
		style="left: {$dragState.ghostPosition.x + 8}px; top: {$dragState.ghostPosition.y -
			14}px; transform: rotate(2deg);"
	>
		{$dragState.draggedConv.title}
	</div>
{/if}
