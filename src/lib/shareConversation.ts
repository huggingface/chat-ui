import { base } from "$app/paths";

export async function shareConversation(id: string, title: string) {
	try {
		const res = await fetch(`${base}/conversation/${id}/share`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
		});

		if (!res.ok) {
			alert("Error while sharing conversation: " + (await res.text()));
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
		console.error(err);
		alert("Error while sharing conversation: " + err);
	}
}
