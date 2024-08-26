import { base } from "$app/paths";
import { ERROR_MESSAGES, error } from "$lib/stores/errors";
import { share } from "./utils/share";
import { page } from "$app/stores";
import { get } from "svelte/store";
import { getShareUrl } from "./utils/getShareUrl";
export async function shareConversation(id: string, title: string) {
	try {
		if (id.length === 7) {
			const url = get(page).url;
			await share(getShareUrl(url, id), title, true);
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

			const { url } = await res.json();
			await share(url, title, true);
		}
	} catch (err) {
		error.set(ERROR_MESSAGES.default);
		console.error(err);
	}
}
