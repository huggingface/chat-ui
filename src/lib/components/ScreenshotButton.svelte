<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import CarbonCamera from "~icons/carbon/camera";
  import { captureScreen } from '$lib/utils/screenshot';

  export let classNames = "";

  const dispatch = createEventDispatcher<{ capture: File[] }>();

  async function handleClick() {
    try {
      const screenshot = await captureScreen();
      
      // Convert base64 to blob
      const base64Response = await fetch(screenshot);
      const blob = await base64Response.blob();
      
      // Create a File object from the blob
      const file = new File([blob], 'screenshot.png', { type: 'image/png' });
      
      // Dispatch the file as an array since FileDropzone expects an array of files
      dispatch('capture', [file]);
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
    }
  }
</script>

<button
  on:click={handleClick}
  class="btn h-8 rounded-lg border bg-white px-3 py-1 text-sm text-gray-500 shadow-sm hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 {classNames}"
>
  <CarbonCamera class="mr-2 text-xxs" /> Capture
</button> 