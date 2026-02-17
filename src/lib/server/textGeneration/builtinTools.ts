import type { OpenAiTool } from "$lib/server/mcp/tools";

export interface BuiltinToolResult {
	text: string;
	structured?: unknown;
}

const GALLERY_TOOL: OpenAiTool = {
	type: "function",
	function: {
		name: "display_gallery",
		description:
			"Display a horizontal scrollable gallery of media items (images, videos, audio) to the user. " +
			"Use this when presenting multiple visual or media results such as image search results, " +
			"product photos, video thumbnails, or audio tracks. Each item needs a URL and media type.",
		parameters: {
			type: "object",
			properties: {
				title: {
					type: "string",
					description: "Optional title displayed above the gallery.",
				},
				items: {
					type: "array",
					description: "The media items to display in the gallery. Minimum 1 item.",
					items: {
						type: "object",
						properties: {
							url: {
								type: "string",
								description: "The URL of the media item (image, video, or audio file).",
							},
							media_type: {
								type: "string",
								enum: ["image", "video", "audio"],
								description: "The type of media.",
							},
							title: {
								type: "string",
								description: "A short title or label for this item.",
							},
							description: {
								type: "string",
								description: "An optional description shown below the item.",
							},
							thumbnail_url: {
								type: "string",
								description:
									"Optional thumbnail URL for video/audio items. If not provided, a default placeholder is used.",
							},
						},
						required: ["url", "media_type"],
					},
				},
			},
			required: ["items"],
		},
	},
};

export const BUILTIN_TOOLS: OpenAiTool[] = [GALLERY_TOOL];

const BUILTIN_TOOL_NAMES = new Set(BUILTIN_TOOLS.map((t) => t.function.name));

export function isBuiltinTool(name: string): boolean {
	return BUILTIN_TOOL_NAMES.has(name);
}

export function executeBuiltinTool(name: string, args: Record<string, unknown>): BuiltinToolResult {
	if (name === "display_gallery") {
		const items = Array.isArray(args.items) ? args.items : [];
		const title = typeof args.title === "string" ? args.title : undefined;
		return {
			text: `Gallery displayed with ${items.length} item(s).${title ? ` Title: ${title}` : ""}`,
			structured: { type: "gallery", title, items },
		};
	}
	return { text: `Unknown built-in tool: ${name}` };
}
