<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { writable } from 'svelte/store';
  import mermaid from 'mermaid';

  export let code: string;

  let diagramElement: HTMLElement;
  let error: string | null = null;
  let loading = false;
  let diagramId: string;
  let debounceTimer: number | null = null;
  let renderedSvg: string | null = null;

  const codeStore = writable('');
  $: codeStore.set(code);

  function validatePartialMermaidSyntax(code: string): boolean {
    const validStarts = ['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'erDiagram', 'journey', 'gantt', 'pie', 'mindmap'];
    return validStarts.some(start => code.trim().toLowerCase().startsWith(start));
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
      loading = false;
      return;
    }

    try {
      await tick(); // Ensure DOM is updated
      const { svg } = await mermaid.render(diagramId, $codeStore);
      renderedSvg = svg;
      error = null;
    } catch (e) {
      console.error("Mermaid diagram rendering failed:", e);
      error = "Failed to render Mermaid diagram. Please check your syntax.";
    } finally {
      loading = false;
    }
  };

  const debouncedRenderDiagram = debounce(renderDiagram, 500);  // 500ms debounce

  $: {
    if ($codeStore) {
      loading = true;
      error = null;
      debouncedRenderDiagram();
    }
  }

  $: if (diagramElement && renderedSvg) {
    diagramElement.innerHTML = renderedSvg;
  }

  onMount(() => {
    mermaid.initialize({ startOnLoad: false });
    diagramId = `mermaid-diagram-${Math.random().toString(36).slice(2, 11)}`;
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });
</script>

{#if loading}
  <div class="loading">Loading diagram...</div>
{:else if error}
  <div class="error-message">{error}</div>
{:else}
  <div bind:this={diagramElement}></div>
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