import { base } from "$app/paths";
import { env } from "$env/dynamic/public";

export function getShareUrl(url: URL, shareId: string): string {
	return `${env.PUBLIC_SHARE_PREFIX || `${env.PUBLIC_ORIGIN || url.origin}${base}`}/r/${shareId}`;
}
