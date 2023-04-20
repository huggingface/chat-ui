<script lang="ts">
	export let classNames: string = '';
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width="40px"
	height="25px"
	viewBox="0 0 60 40"
	preserveAspectRatio="xMidYMid"
	class={classNames}
>
	{#each Array(3) as _, index}
		<g transform={`translate(${20 * index + 10} 20)`}>
			{index}
			<circle cx="0" cy="0" r="6" fill="currentColor">
				<animateTransform
					attributeName="transform"
					type="scale"
					begin={`${-0.375 + 0.15 * index}s`}
					calcMode="spline"
					keySplines="0.3 0 0.7 1;0.3 0 0.7 1"
					values="0.5;1;0.5"
					keyTimes="0;0.5;1"
					dur="1s"
					repeatCount="indefinite"
				/>
			</circle>
		</g>
	{/each}
</svg>
