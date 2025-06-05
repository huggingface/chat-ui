import { base } from "$app/paths";
import { page } from "$app/state";

export function getShareUrl(url: URL, shareId: string): string {
	return `${
		page.data.publicConfig.PUBLIC_SHARE_PREFIX ||
		`${page.data.publicConfig.PUBLIC_ORIGIN || url.origin}${base}`
	}/r/${shareId}`;
}
