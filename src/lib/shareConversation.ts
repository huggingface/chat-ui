import { base } from "$app/paths";
import { ERROR_MESSAGES, error } from "$lib/stores/errors";

export async function shareConversation(id: string, title: string) {
	try {
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

		if (navigator.share) {
			navigator.share({
				title,
				text: "Share this chat with others",
				url,
			});
		} else {
			prompt("Copy this public url to share:", url);
		}
	} catch (err) {
		error.set(ERROR_MESSAGES.default);
		console.error(err);
	}
}
