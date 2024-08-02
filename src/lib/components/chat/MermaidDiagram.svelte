<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { writable } from 'svelte/store';
  import mermaid from 'mermaid';
  import { deflate } from 'pako';
  import CarbonLaunch from "~icons/carbon/launch";

  const DEBOUNCE_DELAY = 500;
  const DEFAULT_MERMAID_THEME = "default";
  const MERMAID_INIT_OPTIONS = {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: DEFAULT_MERMAID_THEME,
    logLevel: 'error',
    suppressErrors: true
  };

  export let code: string;
  
  let mermaidDiagram: HTMLElement;
  let error: string | null = null;
  let isLoading = false;
  let diagramId: string;
  let debounceTimer: number | null = null;
  let renderedMermaidSvg: string | null = null;
  let liveEditorUrl: string = '';

  const codeStore = writable('');
  $: codeStore.set(code);

  function validateMermaidSyntax(code: string): boolean {
    try {
      mermaid.parse(code);
      return true;
    } catch (error) {
      return false;
    }
  }

  function serializeToPako(graphMarkdown: string): string {
    const jGraph = { code: graphMarkdown, mermaid: { theme: DEFAULT_MERMAID_THEME } };
    const jsonString = JSON.stringify(jGraph);
    const byteArray = new TextEncoder().encode(jsonString);
    const compressed = deflate(byteArray, { level: 9 });
    
    return window.btoa(String.fromCharCode.apply(null, Array.from(compressed)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function generateMermaidLiveLink(code: string): string {
    const pakoString = serializeToPako(code);
    return `https://mermaid.live/edit#pako:${pakoString}`;
  }
  
  function debounce(func: Function, delay: number) {
    return (...args: any[]) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        func(...args);
      }, delay) as unknown as number;
    };
  }

  const renderDiagram = async () => {
    if (!validateMermaidSyntax($codeStore)) {
      error = "Invalid Mermaid syntax.";
      isLoading = false;
      return;
    }

    try {
      await tick(); // Ensure DOM is updated
      const { svg } = await mermaid.render(diagramId, $codeStore);
      renderedMermaidSvg = svg;
      error = null;

      // Insert the rendered SVG into the DOM
      if (mermaidDiagram && renderedMermaidSvg) {
        mermaidDiagram.innerHTML = renderedMermaidSvg;
      }

      // Generate the mermaid.live edit link
      liveEditorUrl = generateMermaidLiveLink($codeStore);
      
    } catch (e) {
        console.warn("Mermaid diagram rendering failed:", e);
        // Instead of setting an error, we'll just clear the previous rendering
        renderedMermaidSvg = null;
        if (mermaidDiagram) {
          mermaidDiagram.innerHTML = '';
        }
    } finally {
      isLoading = false;
    }
  };

  const debouncedRenderDiagram = debounce(renderDiagram, DEBOUNCE_DELAY);

  $: {
  if ($codeStore) {
      isLoading = true;
      error = null;
      debouncedRenderDiagram();
    }
  }

  $: if (mermaidDiagram && renderedMermaidSvg) {
    mermaidDiagram.innerHTML = renderedMermaidSvg;
  }

  onMount(() => {
    mermaid.initialize(MERMAID_INIT_OPTIONS);
    diagramId = `mermaid-diagram-${Math.random().toString(36).slice(2, 11)}`;
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });
</script>

<!-- Update the template section -->
{#if isLoading}
  <div class="loading" role="status" aria-live="polite">Loading diagram...</div>
{:else if renderedMermaidSvg}
  <div bind:this={mermaidDiagram} aria-label="Mermaid diagram"></div>
  
  <div class="mt-4 text-sm flex justify-end">
    <a
      href={liveEditorUrl}
      target="_blank"
      rel="noopener noreferrer"
      class="flex items-center gap-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
      aria-label="Edit diagram on mermaid.live (opens in a new tab)"
    >
      <CarbonLaunch class="h-4 w-4" />
      <span>Edit on mermaid.live</span>
    </a>
  </div>
{:else}
  <div class="info-message" role="status">Unable to render diagram. Please check your Mermaid syntax.</div>
{/if}

<style>
.loading {
    color: #888;
    font-style: italic;
    margin: 10px 0;
  }
</style>