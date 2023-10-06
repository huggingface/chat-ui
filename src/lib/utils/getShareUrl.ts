import { base } from "$app/paths";
import { PUBLIC_ORIGIN, PUBLIC_SHARE_PREFIX } from "$env/static/public";

export function getShareUrl(url: URL, shareId: string): string {
	return `${PUBLIC_SHARE_PREFIX || `${PUBLIC_ORIGIN || url.origin}${base}`}/r/${shareId}`;
}
