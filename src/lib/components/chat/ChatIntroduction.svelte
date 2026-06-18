<script lang="ts">
  import Logo from "$lib/components/icons/Logo.svelte";
  import type { Model } from "$lib/types/Model";
  import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

  const publicConfig = usePublicConfig();

  interface Props {
    currentModel: Model;
  }

  let { currentModel }: Props = $props();
</script>

<div class="my-auto grid w-full max-w-3xl items-center justify-center gap-4 text-center">
  <div
    class="mx-auto flex select-none items-center rounded-xl text-3xl font-semibold md:text-5xl"
  >
    <Logo classNames="mr-0.5 size-12 dark:invert md:size-20" />
    {publicConfig.PUBLIC_APP_NAME}
  </div>

  <div class="space-y-1">
    <p class="mx-auto max-w-2xl text-sm text-gray-600 dark:text-gray-300 md:text-base">
      Start a new chat with
      <span class="font-semibold text-gray-800 dark:text-gray-100">
        {currentModel.displayName}
      </span>.
    </p>
  </div>
</div>