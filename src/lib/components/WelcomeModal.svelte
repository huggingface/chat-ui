<script lang="ts">
    import Modal from "$lib/components/Modal.svelte";
    import Logo from "$lib/components/icons/Logo.svelte";
    import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";
    import { useSettingsStore } from "$lib/stores/settings";

    const publicConfig = usePublicConfig();
    const settings = useSettingsStore();
</script>

<Modal on:close={() => ($settings.welcomeModalSeen = true)} width="!max-w-[420px] !m-4">
    <div class="from-black/30 via-black/5 to-transparent flex w-full flex-col items-center gap-5 bg-gradient-to-b px-6 pb-7 pt-8 text-center dark:from-white/10 dark:via-white/5">
        <h2 class="flex items-center text-2xl font-semibold text-gray-900 dark:text-gray-100">
            <Logo classNames="mr-2" /> {publicConfig.PUBLIC_APP_NAME}
        </h2>

        <div class="text-gray-700 dark:text-gray-200">
            <p class="text-[15px] leading-relaxed">
                Welcome to {publicConfig.PUBLIC_APP_NAME}, the open source chat app powered by open source AI.
            </p>
            <p class="mt-3 text-[15px] leading-relaxed">
                To give you the best answer, it can automatically select the best AI model based on your query. You can also choose from many state-of-the-art open‑source models to chat with directly. Happy chatting!
            </p>
        </div>

        <button
            class="mt-2 w-full rounded-full border-2 border-black bg-white px-5 py-2 text-lg font-semibold text-black hover:bg-gray-100 dark:border-white dark:bg-black dark:text-white dark:hover:bg-gray-900"
            onclick={() => ($settings.welcomeModalSeen = true)}
        >
            Start chatting
        </button>
    </div>
</Modal>

