import { base } from "$app/paths";
import { publicConfig } from "$lib/utils/PublicConfig.svelte";

export function getShareUrl(url: URL, shareId: string): string {
	return `${
		publicConfig.PUBLIC_SHARE_PREFIX || `${publicConfig.PUBLIC_ORIGIN || url.origin}${base}`
	}/r/${shareId}`;
}
