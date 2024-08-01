<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { writable } from 'svelte/store';
  import mermaid from 'mermaid';
  import { deflate } from 'pako';
  import CarbonLaunch from "~icons/carbon/launch";

  const DEBOUNCE_DELAY = 500;
  const DEFAULT_MERMAID_THEME = "default";

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

  function validatePartialMermaidSyntax(code: string): boolean {
    const validStarts = ['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'erDiagram', 'journey', 'gantt', 'pie', 'mindmap'];
    return validStarts.some(start => code.trim().toLowerCase().startsWith(start));
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
    if (!validatePartialMermaidSyntax($codeStore)) {
      error = "Invalid or incomplete Mermaid syntax. Please check your diagram code.";
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
      const pakoString = serializeToPako($codeStore);
      liveEditorUrl = `https://mermaid.live/edit#pako:${pakoString}`;
      
    } catch (e) {
      console.error("Mermaid diagram rendering failed:", e);
      error = "Failed to render Mermaid diagram. Please check your syntax.";
    } finally {
      isLoading = false;
    }
  };

  const debouncedRenderDiagram = debounce(renderDiagram, DEBOUNCE_DELAY);  // 500ms debounce

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
    mermaid.initialize({ startOnLoad: false });
    diagramId = `mermaid-diagram-${Math.random().toString(36).slice(2, 11)}`;
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });
</script>


{#if isLoading}
  <div class="loading" role="status" aria-live="polite">Loading diagram...</div>
{:else if error}
  <div class="error-message" role="alert">{error}</div>
{:else}
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
  
{/if}

<style>
  .error-message {
    color: red;
    font-style: italic;
    margin: 10px 0;
  }
  .loading {
    color: #888;
    font-style: italic;
    margin: 10px 0;
  }

</style>