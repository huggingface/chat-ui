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
		`You can use the following tools if helpful: ${names.join(", ")}.`,
		`Today's date: ${currentDate}.`,
		`If a tool generates an image, you can inline it directly: ![alt text](image_url).`,
		`If a tool needs to operate on a user-attached image, set its image input parameter (for example, "input_image") to an image reference string.`,
		`Use "latest" for the most recently attached image, or "image_1", "image_2", etc. to refer to specific images in the latest user message instead of passing full URLs or base64 data.`,
	].join(" ");
}
