<script>
	import { onMount } from 'svelte';

	/** @type {HTMLDialogElement} */
	let modal;

	onMount(() => {
		const selection = window.getSelection();

		const active = /** @type {HTMLElement} */ (document.activeElement);
		const sfnsp = selection?.focusNode?.parentElement;

		if (modal.showModal) modal.showModal();

		return () => {
			setTimeout(() => {
				if (active && active !== document.body) {
					active.focus();
					return;
				}

				// reset sequential focus navigation starting point (ideally this
				// would be automatic with <dialog>, i think)
				if (sfnsp) {
					const tabindex = sfnsp.getAttribute('tabindex');

					sfnsp.setAttribute('tabindex', '-1');
					sfnsp.focus();
					sfnsp.blur();

					if (tabindex) {
						sfnsp.setAttribute('tabindex', tabindex);
					} else {
						sfnsp.removeAttribute('tabindex');
					}
				}
			}, 0);
		};
	});
</script>

<div class="modal-background" />

<dialog class="modal" tabindex="-1" bind:this={modal} on:close>
	<slot />
</dialog>

<style>
	/* when enough people have upgraded Safari, we can use
	   dialog::backdrop instead, but not yet */
	.modal-background {
		position: fixed;
		width: 100%;
		height: 100%;
		left: 0;
		top: 0;
		background: rgba(0, 0, 0, 0.3);
		backdrop-filter: grayscale(0.7) blur(3px);
		z-index: 99998;
	}

	dialog {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: calc(100vw - 2rem);
		max-width: 56rem;
		background: var(--sk-back-2);
		color: var(--sk-text-2);
		padding: 2rem;
		border: none;
		border-radius: 0.5rem;
		filter: drop-shadow(3px 5px 10px rgba(0, 0, 0, 0.1));
		z-index: 99999;
	}
</style>
