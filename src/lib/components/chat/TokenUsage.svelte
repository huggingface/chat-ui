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
        if (value < 0.01) return "0.1%";
        if (value >= 1) return Math.round(value * 100) + "%";
        return (Math.round(value * 1000) / 10).toFixed(1) + "%";
    }
  
    function formatCurrency(value: number | null): string {
        if (value === null) return 'N/A';
        if (value < 0.01) return "< $0.01";
        return '$' + (Math.ceil(value * 100) / 100).toFixed(2);
    }
  
    function formatTableCost(value: number | null): string {
        if(value === null) return "N/A";
        return '$' + value.toFixed(4);
    }
  
    function formatPrice(value: number): string {
        return '$' + value.toFixed(2);
    }
  
    $: totalTokens = usage.input_tokens + usage.output_tokens;
    $: percentageUsed = totalTokens / tokenInfo.contextWindow;
    $: cost = tokenInfo.pricing
        ? (usage.input_tokens * tokenInfo.pricing.input + usage.output_tokens * tokenInfo.pricing.output) / 1_000_000
        : null;
    
    $: progressBarColor = percentageUsed > 80 ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600';
  </script>
  
  <div class="mt-4 text-sm">
    <button
        class="flex items-center gap-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
        on:click={() => expanded = !expanded}
    >
        {#if tokenInfo.pricing}
            <span>Last Turn: {formatCurrency(cost)} | Context Use: {formatPercentage(percentageUsed)}</span>
        {:else}
            <span>Context Use: {formatPercentage(percentageUsed)}</span>
        {/if}
    </button>
    
    
    {#if expanded}
        <div transition:slide="{{ duration: 300 }}" class="mt-2 text-gray-500 dark:text-gray-400">
            <div class="w-1/3 min-w-[300px] text-sm prose max-w-none max-sm:prose-sm dark:prose-invert prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-base prose-pre:bg-gray-800 dark:prose-pre:bg-gray-900">
 <!--               <div class=" bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 overflow-hidden">
                    <div 
                      class="h-2.5 rounded-full {progressBarColor} transition-all duration-200 ease-in-out" 
                      style="width: {percentageUsed}%"
                    </div> 
                  </div>   -->             
                <table>
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th class="text-right">Tokens</th>
                            {#if tokenInfo.pricing}
                                <th class="text-right">Price (m/tok)</th>
                                <th class="text-right">Cost</th>
                            {/if}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="pr-2">Input</td>
                            <td class="text-right px-2">{formatTokenCount(usage.input_tokens)}</td>
                            {#if tokenInfo.pricing}
                                <td class="text-right px-2">{formatPrice(tokenInfo.pricing.input)}</td>
                                <td class="text-right pl-2">{formatTableCost(usage.input_tokens * tokenInfo.pricing.input / 1_000_000)}</td>
                            {/if}
                        </tr>
                        <tr>
                            <td class="pr-2">Output</td>
                            <td class="text-right px-2">{formatTokenCount(usage.output_tokens)}</td>
                            {#if tokenInfo.pricing}
                                <td class="text-right px-2">{formatPrice(tokenInfo.pricing.output)}</td>
                                <td class="text-right pl-2">{formatTableCost(usage.output_tokens * tokenInfo.pricing.output / 1_000_000)}</td>
                            {/if}
                        </tr>
                        <tr class="font-semibold">
                            <td class="pr-2">Total</td>
                            <td class="text-right px-2">{formatTokenCount(totalTokens)}</td>
                            {#if tokenInfo.pricing}
                                <td></td>
                                <td class="text-right pl-2">{formatTableCost(cost)}</td>
                            {/if}
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    {/if}
</div>