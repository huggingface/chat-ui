import type { OpenAiTool } from "$lib/server/mcp/tools";

export function buildToolPreprompt(tools: OpenAiTool[]): string {
	if (!Array.isArray(tools) || tools.length === 0) return "";
	const names = tools
		.map((t) => (t?.function?.name ? String(t.function.name) : ""))
		.filter((s) => s.length > 0);
	if (names.length === 0) return "";
	const currentDate = new Date().toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	return [
		`You have access to these tools: ${names.join(", ")}.`,
		`Today's date: ${currentDate}.`,
		`Only use a tool if you cannot answer without it. For simple tasks like writing, editing text, or answering from your knowledge, respond directly without tools.`,
		`If a tool generates an image, video, or audio, you can inline it using ![alt](url) or raw <video>/<audio> HTML tags. Video (.mp4, .webm) and audio (.mp3, .wav) URLs will render as playable media.`,
		`If a tool needs an image, set its image field ("input_image", "image", or "image_url") to a reference like "image_1", "image_2", etc. (ordered by when the user uploaded them).`,
		`Default to image references; only use a full http(s) URL when the tool description explicitly asks for one, or reuse a URL a previous tool returned.`,
		`When citing, use [1], [2] etc. Sources will be shown as footnotes.`,
	].join(" ");
}
