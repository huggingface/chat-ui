import { base } from "$app/paths";
import { ERROR_MESSAGES, error } from "$lib/stores/errors";
import { share } from "./utils/share";
import { page } from "$app/state";

export async function shareConversation(id: string, title: string) {
	try {
		if (id.length === 7) {
			const shareUrl = `${
				page.data.publicConfig.PUBLIC_SHARE_PREFIX ||
				`${page.data.publicConfig.PUBLIC_ORIGIN || page.url.origin}${base}`
			}/r/${id}`;
			await share(shareUrl, title, true);
		} else {
			const res = await fetch(`${base}/conversation/${id}/share`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
			});

			if (!res.ok) {
				error.set("Error while sharing conversation, try again.");
				console.error("Error while sharing conversation: " + (await res.text()));
				return;
			}

			const { shareId } = await res.json();

			const shareUrl = `${
				page.data.publicConfig.PUBLIC_SHARE_PREFIX ||
				`${page.data.publicConfig.PUBLIC_ORIGIN || page.url.origin}${base}`
			}/r/${shareId}`;

			await share(shareUrl, title, true);
		}
	} catch (err) {
		error.set(ERROR_MESSAGES.default);
		console.error(err);
	}
}
