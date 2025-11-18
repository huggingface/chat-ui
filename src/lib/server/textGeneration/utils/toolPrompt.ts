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
		`If a tool needs to operate on an image, set its image input parameter (for example, "input_image") to an image reference string.`,
		`Use "image_1", "image_2", etc. to point to a specific image from a user message with images. You can also reuse a direct image URL from a prior tool result instead of pasting new base64 data.`,
	].join(" ");
}
