<script lang="ts">
    interface Props {
        checked: boolean;
        name: string;
    }

    let { checked = $bindable(), name }: Props = $props();

    function toggle() {
        checked = !checked;
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
        }
    }
</script>

<input bind:checked type="checkbox" {name} class="peer pointer-events-none absolute opacity-0" />
<div
    aria-checked={checked}
    aria-roledescription="switch"
    aria-label="switch"
    role="switch"
    tabindex="0"
    on:click={toggle}
    on:keydown={onKeydown}
    class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-gray-300 p-1 shadow-inner ring-gray-400 transition-all hover:bg-gray-400 focus-visible:ring focus-visible:ring-offset-1 peer-checked:bg-blue-600 dark:bg-gray-600 peer-checked:[&>div]:translate-x-3.5"
>
    <div class="h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all"></div>
    </div>
