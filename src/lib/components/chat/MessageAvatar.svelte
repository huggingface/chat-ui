<script lang="ts">
	const { animating = false, classNames = "" } = $props();

	let blobAnim = $state<SVGAnimateElement>();
	let svgEl = $state<SVGSVGElement>();

	$effect(() => {
		if (!blobAnim) return;

		if (animating) {
			// Resume animations and start once
			svgEl?.unpauseAnimations?.();
			blobAnim.beginElement();
		}

		return () => {
			svgEl?.pauseAnimations?.();
		};
	});
</script>

<svg
	bind:this={svgEl}
	class={classNames}
	id="ball"
	viewBox="0 0 12 12"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	aria-label="Ball mask"
>
	<g clip-path="url(#a)">
		<!-- circular mask -->
		<path d="M12 6A6 6 0 1 0 0 6a6 6 0 0 0 12 0Z" fill="#fff" />
		<mask id="b" style="mask-type:luminance" x="0" y="0" width="12" height="12">
			<path d="M12 6A6 6 0 1 0 0 6a6 6 0 0 0 12 0Z" fill="#fff" />
		</mask>

		<!-- the blurred black shape inside the circular mask -->
		<g mask="url(#b)">
			<!-- BASE state (normalized to absolute L commands) -->
			<path
				class="blur-[1.2px]"
				id="blob"
				fill="#000"
				d="M11 1 L8 -4 L3 -8 L-6 6 L3 12 L7 11 L6 2 L11 1 Z"
			>
				<!-- MORPH: base -> mid -> far -> mid -> base -->
				<animate
					bind:this={blobAnim}
					attributeName="d"
					begin="indefinite"
					end="indefinite"
					dur="3.2s"
					repeatCount={"indefinite"}
					fill="freeze"
					calcMode="spline"
					keyTimes="0; .33; .66; .9; 1"
					keySplines="
            .4 0 .2 1;
            .4 0 .2 1;
            .4 0 .2 1;
            .4 0 .2 1"
					values="
            M11 1 L8 -4 L3 -8 L-6 6 L3 12 L7 11 L6 2 L11 1 Z;
            M11 1 L8 -4 L3 -8 L-6 6 L3 12 L5 9  L7 4  L11 1 Z;
            M11 1 L8 -4 L3 -8 L-6 6 L3 12 L3 6  L5 1  L11 1 Z;
            M11 1 L8 -4 L3 -8 L-6 6 L3 12 L5 9  L7 4  L11 1 Z;
            M11 1 L8 -4 L3 -8 L-6 6 L3 12 L7 11 L6 2 L11 1 Z"
				/>
			</path>
		</g>
	</g>

	<defs>
		<clipPath id="a"><path fill="#fff" d="M0 0h12v12H0z" /></clipPath>
	</defs>
</svg>
