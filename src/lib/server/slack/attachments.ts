import type { ThreadMessage } from "./context";

export interface SlackFile {
	id?: string;
	name?: string;
	mimetype?: string;
	size?: number;
	url_private?: string;
	url_private_download?: string;
}
const MAX_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;

/** Only authenticated Slack file URLs; never forward the bot credential to a redirect host. */
export async function downloadAttachments(
	messages: ThreadMessage[],
	throughTs: string,
	botUser: string,
	token: string
): Promise<File[]> {
	const selected = new Map<string, SlackFile>();
	for (const message of messages) {
		if (
			!message.ts ||
			Number(message.ts) > Number(throughTs) ||
			message.user === botUser ||
			message.bot_id
		)
			continue;
		for (const file of message.files ?? []) {
			const key = file.id ?? file.url_private_download ?? file.url_private;
			if (key) selected.set(key, file);
		}
	}
	if (selected.size > 10)
		throw Error(
			"There are more than 10 attachments in this thread. Please start a new thread with the files you want to use."
		);
	const files: File[] = [];
	let total = 0;
	for (const file of selected.values()) {
		if ((file.size ?? 0) > MAX_FILE) throw Error("An attachment exceeds the 10 MB per-file limit.");
		const source = file.url_private_download ?? file.url_private;
		if (!source)
			throw Error(
				"Slack did not provide a download URL. Add files:read to the bot scopes and reinstall the app, then try again."
			);
		let url = new URL(source);
		if (url.hostname !== "files.slack.com")
			throw Error("This attachment is not a downloadable Slack file.");
		let response: Response | undefined;
		for (let redirects = 0; redirects <= 3; redirects++) {
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				url.port ||
				!(url.hostname === "files.slack.com" || url.hostname.endsWith(".slack-edge.com"))
			)
				throw Error("Slack returned an unsupported attachment download URL.");
			response = await fetch(url, {
				headers: url.hostname === "files.slack.com" ? { Authorization: `Bearer ${token}` } : {},
				redirect: "manual",
				signal: AbortSignal.timeout(20000),
			});
			if (![301, 302, 303, 307, 308].includes(response.status)) break;
			const location = response.headers.get("location");
			await response.body?.cancel();
			if (!location) throw Error("Slack attachment download failed.");
			url = new URL(location, url);
		}
		if (
			!response?.ok ||
			!response.body ||
			(response.headers.get("content-type")?.includes("text/html") && file.mimetype !== "text/html")
		)
			throw Error(
				"Could not download a Slack attachment. Add files:read to the bot scopes and reinstall the Slack app, then try again."
			);
		const buffers: Uint8Array[] = [];
		const reader = response.body.getReader();
		let size = 0;
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				size += value.byteLength;
				total += value.byteLength;
				if (size > MAX_FILE || total > MAX_TOTAL)
					throw Error("Attachments exceed the 10 MB per-file or 25 MB total limit.");
				buffers.push(value);
			}
		} finally {
			await reader.cancel();
		}
		files.push(
			new File([Buffer.concat(buffers)], file.name ?? file.id ?? "attachment", {
				type: file.mimetype ?? response.headers.get("content-type") ?? "application/octet-stream",
			})
		);
	}
	return files;
}
