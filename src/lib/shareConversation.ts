import { base } from "$app/paths";
import { ERROR_MESSAGES, error } from "$lib/stores/errors";
import { share } from "./utils/share";
import { page } from "$app/stores";
import { get } from "svelte/store";
import { getShareUrl } from "./utils/getShareUrl";
export async function shareConversation(id: string, title: string) {
	try {
		if (id.length === 7) {
			// TODO: I think we want to get rid of these separate sharedConversation items and table
			const url = get(page).url;
			await share(getShareUrl(url, id), title);
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
			await share(url, title);
		}
	} catch (err) {
		error.set(ERROR_MESSAGES.default);
		console.error(err);
	}
}

export async function unshareConversation(id: string) {
	try {
		if (id.length === 7) {
			// TODO: eliminate this case or error out
			error.set("Only the conversation owner can unshare.");
		} else {
			const res = await fetch(`${base}/conversation/${id}/unshare`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
			});

			if (!res.ok) {
				error.set("Error while unsharing conversation, try again.");
				console.error("Error while unsharing conversation: " + (await res.text()));
				return;
			}

		}
	} catch (err) {
		error.set(ERROR_MESSAGES.default);
		console.error(err);
	}
}
