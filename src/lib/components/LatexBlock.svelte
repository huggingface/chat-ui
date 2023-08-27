<script lang="ts">
	import { afterUpdate, onMount } from "svelte";

	export let code = "";

	onMount(() => {
		let script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js";
        document.head.append(script);  
        script.onload = () => {
            MathJax = {
                tex: {inlineMath: [['$', '$'], ['\\(', '\\)']]},
                svg: {fontCache: 'global'}
            };
		};					  
	});
</script>

<div class="group relative my-4 rounded-lg">
	<!-- eslint-disable svelte/no-at-html-tags -->
    <p class="overflow-auto px-5 scrollbar-thumb-gray-500 hover:scrollbar-thumb-gray-400">
        {code}
    </p>
</div>
