<script lang="ts">
    import { slide } from 'svelte/transition';
    import CarbonInformation from "~icons/carbon/information";
  
    export let usage: { input_tokens: number; output_tokens: number };
    
    let expanded = false;
  
    function formatTokenCount(count: number): string {
      return count.toLocaleString();
    }
  </script>
  
  <div class="mt-4 text-sm">
    <button
      class="flex items-center gap-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      on:click={() => expanded = !expanded}
    >
      <CarbonInformation class="h-4 w-4" />
      <span>Token Usage</span>
    </button>
    
    {#if expanded}
      <div transition:slide="{{ duration: 300 }}" class="mt-2 pl-6 text-gray-500 dark:text-gray-400">
        <div>Input: {formatTokenCount(usage.input_tokens)}</div>
        <div>Output: {formatTokenCount(usage.output_tokens)}</div>
        <div>Total: {formatTokenCount(usage.input_tokens + usage.output_tokens)}</div>
      </div>
    {/if}
  </div>