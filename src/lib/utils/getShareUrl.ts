import { base } from "$app/paths";
import { env as envPublic } from "$env/dynamic/public";

export function getShareUrl(url: URL, shareId: string): string {
	return `${
		envPublic.PUBLIC_SHARE_PREFIX || `${envPublic.PUBLIC_ORIGIN || url.origin}${base}`
	}/r/${shareId}`;
}
