<script lang="ts">
	import { usePublicConfig } from "$lib/utils/PublicConfig.svelte";

	const publicConfig = usePublicConfig();

	interface Props {
		classNames?: string;
		variant?: "default" | "nav";
	}

	let { classNames = "", variant = "default" }: Props = $props();

	// For nav variant: use PUBLIC_APP_LOGO_NAV_URL if set, otherwise fall back to default asset path
	// For default variant: use PUBLIC_APP_LOGO_URL if set, otherwise fall back to default asset path
	let logoSrc = $derived(
		variant === "nav"
			? (publicConfig.PUBLIC_APP_LOGO_NAV_URL || `${publicConfig.assetPath}/logo.svg`)
			: (publicConfig.PUBLIC_APP_LOGO_URL || `${publicConfig.assetPath}/logo.svg`)
	);

	// Apply different styles based on variant
	// "default" uses PUBLIC_APP_LOGO_STYLE (for main intro screen)
	// "nav" uses PUBLIC_APP_LOGO_NAV_STYLE (for sidebar navigation)
	let logoStyle = $derived(
		variant === "nav"
			? (publicConfig.PUBLIC_APP_LOGO_NAV_STYLE || "height: 1.5em; width: auto;")
			: (publicConfig.PUBLIC_APP_LOGO_STYLE || "")
	);
</script>

<img
	class={classNames}
	style={logoStyle}
	alt="{publicConfig.PUBLIC_APP_NAME} logo"
	src={logoSrc}
/>
