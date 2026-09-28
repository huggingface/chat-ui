<script lang="ts">
	const id = $props.id();
</script>

<svg viewBox="0 0 96 112" fill="none" class="ml-intern-flask" aria-hidden="true" focusable="false">
	<defs>
		<linearGradient id="{id}-glass" x1="30" y1="12" x2="65" y2="100" gradientUnits="userSpaceOnUse">
			<stop stop-color="#ff9b26" stop-opacity=".25" />
			<stop offset=".48" stop-color="#f47708" stop-opacity=".12" />
			<stop offset="1" stop-color="#ff8a00" stop-opacity=".4" />
		</linearGradient>
		<linearGradient id="{id}-rim" x1="32" y1="9" x2="67" y2="102" gradientUnits="userSpaceOnUse">
			<stop stop-color="var(--flask-rim-top)" />
			<stop offset=".25" stop-color="var(--flask-rim-upper)" />
			<stop offset=".64" stop-color="var(--flask-rim-lower)" />
			<stop offset="1" stop-color="var(--flask-rim-bottom)" />
		</linearGradient>
		<linearGradient id="{id}-liquid" x1="48" y1="69" x2="48" y2="98" gradientUnits="userSpaceOnUse">
			<stop stop-color="var(--flask-liquid-top)" />
			<stop offset=".34" stop-color="var(--flask-liquid-middle)" />
			<stop offset="1" stop-color="#ff7800" />
		</linearGradient>
		<linearGradient
			id="{id}-back-wave"
			x1="25"
			y1="70"
			x2="62"
			y2="89"
			gradientUnits="userSpaceOnUse"
		>
			<stop stop-color="#ffb33b" />
			<stop offset="1" stop-color="#f77906" />
		</linearGradient>
		<linearGradient id="{id}-lip" x1="48" y1="8" x2="48" y2="16" gradientUnits="userSpaceOnUse">
			<stop stop-color="var(--flask-lip-top)" />
			<stop offset=".5" stop-color="var(--flask-lip-middle)" />
			<stop offset="1" stop-color="var(--flask-lip-bottom)" />
		</linearGradient>
		<radialGradient id="{id}-halo">
			<stop stop-color="#ff8a00" stop-opacity=".7" />
			<stop offset=".45" stop-color="#ff6a00" stop-opacity=".3" />
			<stop offset="1" stop-color="#ff6a00" stop-opacity="0" />
		</radialGradient>
		<filter
			id="{id}-glow"
			x="-70%"
			y="-50%"
			width="240%"
			height="210%"
			color-interpolation-filters="sRGB"
		>
			<feGaussianBlur stdDeviation="6" />
		</filter>
		<filter
			id="{id}-soft-glow"
			x="-30%"
			y="-25%"
			width="160%"
			height="150%"
			color-interpolation-filters="sRGB"
		>
			<feGaussianBlur stdDeviation="1.5" />
		</filter>
		<path
			id="{id}-bottle"
			d="M37 13H59V36C59 38 60 40 61 42L82 81C87 90 81 100 71 100H25C15 100 9 90 14 81L35 42C36 40 37 38 37 36Z"
		/>
		<clipPath id="{id}-inside">
			<use href="#{id}-bottle" />
		</clipPath>
	</defs>

	<ellipse class="flask-halo" cx="47" cy="86" rx="62" ry="46" fill="url(#{id}-halo)" />
	<use
		class="flask-glow"
		href="#{id}-bottle"
		stroke="#ff8a00"
		stroke-width="7"
		filter="url(#{id}-glow)"
		opacity=".7"
	/>
	<use class="flask-glass" href="#{id}-bottle" fill="url(#{id}-glass)" />
	<g clip-path="url(#{id}-inside)">
		<path d="M13 77C24 61 38 74 50 76S70 75 83 82V103H13Z" fill="url(#{id}-back-wave)" />
		<path d="M12 74C28 86 40 75 54 71S74 67 85 79V103H12Z" fill="url(#{id}-liquid)" />
		<path d="M12 74C28 86 40 75 54 71S74 67 85 79" stroke="#ffdf76" stroke-opacity=".25" />
	</g>
	<use
		class="flask-inner-rim"
		href="#{id}-bottle"
		clip-path="url(#{id}-inside)"
		stroke="#ffe9aa"
		stroke-width="12"
		stroke-linejoin="round"
	/>
	<use href="#{id}-bottle" stroke="url(#{id}-rim)" stroke-width="5" stroke-linejoin="round" />
	<!-- A narrow reflection keeps the glass edge bright without flattening its gold gradient. -->
	<path
		d="M36 17V36C36 39 35 41 34 43L13 82C9 91 16 101 25 101"
		stroke="#fff0ae"
		stroke-opacity=".45"
		stroke-width="1"
		stroke-linecap="round"
	/>
	<path
		class="flask-lip-glow"
		d="M34 12H62"
		stroke="#ffc544"
		stroke-width="10"
		stroke-linecap="round"
		filter="url(#{id}-soft-glow)"
		opacity=".6"
	/>
	<path d="M34 12H62" stroke="url(#{id}-lip)" stroke-width="7.5" stroke-linecap="round" />
	<path
		class="flask-lip-inset"
		d="M34 12H62"
		stroke="#fff0c5"
		stroke-width="2.5"
		stroke-linecap="round"
	/>
	<path
		class="flask-lip-highlight"
		d="M35 9H61"
		stroke="#fff1b0"
		stroke-opacity=".55"
		stroke-width="1"
		stroke-linecap="round"
	/>
	<circle cx="44" cy="56" r="3.25" fill="var(--flask-bubble, url(#{id}-lip))" />
	<circle cx="53" cy="64" r="2.75" fill="var(--flask-bubble, url(#{id}-liquid))" />
</svg>

<style>
	.ml-intern-flask {
		--flask-rim-top: #e49300;
		--flask-rim-upper: #ed9900;
		--flask-rim-lower: #ff9800;
		--flask-rim-bottom: #ff9d0a;
		--flask-liquid-top: #ffa800;
		--flask-liquid-middle: #ff9500;
		--flask-lip-top: #e59400;
		--flask-lip-middle: #ee9b00;
		--flask-lip-bottom: #f4a20a;
		--flask-bubble: #ec9600;
		display: block;
		width: 36px;
		height: 44px;
		overflow: visible;
	}

	.flask-halo,
	.flask-glass {
		opacity: 0.55;
	}

	.flask-glow {
		opacity: 0.25;
	}

	.flask-lip-glow {
		opacity: 0.12;
	}

	.flask-lip-highlight {
		opacity: 0;
	}

	:global(.dark) .ml-intern-flask {
		--flask-rim-top: #ffe58a;
		--flask-rim-upper: #ffc04b;
		--flask-rim-lower: #ffc043;
		--flask-rim-bottom: #ffb719;
		--flask-liquid-top: #ffd34d;
		--flask-liquid-middle: #ffa813;
		--flask-lip-top: #ffea97;
		--flask-lip-middle: #ffd05e;
		--flask-lip-bottom: #ffb32a;
		--flask-bubble: initial;
	}

	:global(.dark) .flask-halo,
	:global(.dark) .flask-glass,
	:global(.dark) .flask-lip-highlight {
		opacity: 1;
	}

	:global(.dark) .flask-glow {
		opacity: 0.7;
	}

	:global(.dark) .flask-lip-glow {
		opacity: 0.6;
	}

	:global(.dark) .flask-inner-rim,
	:global(.dark) .flask-lip-inset {
		opacity: 0;
	}
</style>
