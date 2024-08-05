<script lang="ts">
    import { slide } from 'svelte/transition';
    import CarbonInformation from "~icons/carbon/information";
  
    export let usage: { input_tokens: number; output_tokens: number };
    export let tokenInfo: {
        contextWindow: number;
        pricing?: {
            input: number;
            output: number;
        };
    };
    
    let expanded = false;
  
    function formatTokenCount(count: number): string {
        return count.toLocaleString();
    }
  
    function formatPercentage(value: number): string {
        return (value * 100).toFixed(1) + '%';
    }
  
    function formatCurrency(value: number | null): string {
        return value !== null ? '$' + value.toFixed(3) : 'N/A';    }
  
    function formatPrice(value: number): string {
        return '$' + value.toFixed(2);
    }
  
    $: totalTokens = usage.input_tokens + usage.output_tokens;
    $: percentageUsed = totalTokens / tokenInfo.contextWindow;
    $: cost = tokenInfo.pricing
        ? (usage.input_tokens * tokenInfo.pricing.input + usage.output_tokens * tokenInfo.pricing.output) / 1_000_000
        : null;
    
    $: progressBarWidth = `${Math.min(percentageUsed * 100, 100)}%`;
    $: progressBarColor = percentageUsed > 0.9 ? 'bg-red-500' : percentageUsed > 0.7 ? 'bg-yellow-500' : 'bg-green-500';
  </script>
  
  <div class="mt-4 text-sm">
    <button
        class="flex items-center gap-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
        on:click={() => expanded = !expanded}
    >
        <CarbonInformation class="h-4 w-4" />
        {#if tokenInfo.pricing}
            <span>Last Turn: {formatCurrency(cost)} | Context Usage: {formatPercentage(percentageUsed)}</span>
        {:else}
            <span>Context Usage: {formatPercentage(percentageUsed)}</span>
        {/if}
    </button>
    
    <div class="mt-1 w-1/3 bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
      <div class="h-2.5 rounded-full {progressBarColor}" style="width: {progressBarWidth}"></div>
    </div>
    
    {#if expanded}
        <div transition:slide="{{ duration: 300 }}" class="mt-2 text-gray-500 dark:text-gray-400">
            <div class="w-1/3 min-w-[300px]">
                <table class="w-full">
                    <thead>
                        <tr>
                            <th class="text-left pr-2">Type</th>
                            <th class="text-right px-2">Tokens</th>
                            {#if tokenInfo.pricing}
                                <th class="text-right px-2">Price (m/tok)</th>
                                <th class="text-right pl-2">Cost</th>
                            {/if}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="pr-2">Input</td>
                            <td class="text-right px-2">{formatTokenCount(usage.input_tokens)}</td>
                            {#if tokenInfo.pricing}
                                <td class="text-right px-2">{formatPrice(tokenInfo.pricing.input)}</td>
                                <td class="text-right pl-2">{formatCurrency(usage.input_tokens * tokenInfo.pricing.input / 1_000_000)}</td>
                            {/if}
                        </tr>
                        <tr>
                            <td class="pr-2">Output</td>
                            <td class="text-right px-2">{formatTokenCount(usage.output_tokens)}</td>
                            {#if tokenInfo.pricing}
                                <td class="text-right px-2">{formatPrice(tokenInfo.pricing.output)}</td>
                                <td class="text-right pl-2">{formatCurrency(usage.output_tokens * tokenInfo.pricing.output / 1_000_000)}</td>
                            {/if}
                        </tr>
                        <tr class="font-bold">
                            <td class="pr-2">Total</td>
                            <td class="text-right px-2">{formatTokenCount(totalTokens)}</td>
                            {#if tokenInfo.pricing}
                                <td></td>
                                <td class="text-right pl-2">{formatCurrency(cost)}</td>
                            {/if}
                        </tr>
                    </tbody>
                </table>
                <div class="mt-2 flex justify-between">
                    <span class="font-bold">Context Window:</span>
                    <span>{formatTokenCount(tokenInfo.contextWindow)} tokens</span>
                </div>                
                </div>

    </div>
{/if}
</div>