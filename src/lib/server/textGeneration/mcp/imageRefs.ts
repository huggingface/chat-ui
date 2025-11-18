import type { EndpointMessage } from "../../endpoints/endpoints";

export type ImageRefPayload = {
	name: string;
	mime: string;
	base64: string;
};

export type ImageRefResolver = (ref: string) => ImageRefPayload | undefined;

/**
 * Build a simple image reference resolver based on the latest user message
 * that has image/* files after preprocessing. This allows tools to accept
 * a lightweight string reference (e.g. "latest", "image_1") and receive
 * a resolved image payload in their arguments without exposing large data
 * URLs or binary blobs to the model itself.
 */
export function buildImageRefResolver(messages: EndpointMessage[]): ImageRefResolver | undefined {
	// Find the last user message that has at least one image file
	let lastUserWithImages: EndpointMessage | undefined;
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const msg = messages[i];
		if (msg.from !== "user") continue;
		const hasImages = (msg.files ?? []).some(
			(file) => typeof file?.mime === "string" && file.mime.startsWith("image/")
		);
		if (hasImages) {
			lastUserWithImages = msg;
			break;
		}
	}

	if (!lastUserWithImages) {
		return undefined;
	}

	const imageFiles = (lastUserWithImages.files ?? []).filter(
		(file) => typeof file?.mime === "string" && file.mime.startsWith("image/")
	);

	if (imageFiles.length === 0) {
		return undefined;
	}

	const resolver: ImageRefResolver = (ref) => {
		if (!ref || typeof ref !== "string") return undefined;
		const trimmed = ref.trim().toLowerCase();
		if (trimmed === "latest") {
			const f = imageFiles[imageFiles.length - 1];
			if (!f) return undefined;
			return { name: f.name, mime: f.mime, base64: f.value };
		}
		const match = /^image_(\d+)$/.exec(trimmed);
		if (match) {
			const idx = Number(match[1]) - 1;
			if (Number.isFinite(idx) && idx >= 0 && idx < imageFiles.length) {
				const f = imageFiles[idx];
				if (!f) return undefined;
				return { name: f.name, mime: f.mime, base64: f.value };
			}
		}
		return undefined;
	};

	return resolver;
}

/**
 * Walk a tool arguments object and attach resolved image payloads for any
 * recognized image reference fields.
 *
 * - For explicit { image_ref } fields, attach an { image } object alongside
 *   the reference (for custom tools that understand { image_ref, image }).
 * - For fields like "input_image" that expect a URL, rewrite the value to
 *   a data: URL built from the resolved image payload.
 */
export function attachImageRefsToArgs(
	argsObj: Record<string, unknown>,
	resolveImageRef?: ImageRefResolver
): void {
	if (!resolveImageRef) return;

	const visit = (value: unknown): void => {
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const v of value) visit(v);
			return;
		}
		const obj = value as Record<string, unknown>;
		for (const [key, v] of Object.entries(obj)) {
			if (typeof v !== "string") {
				if (v && typeof v === "object") visit(v);
				continue;
			}

			const resolved = resolveImageRef(v);
			if (!resolved) continue;

			// Primary convention: explicit image_ref field that gets an attached
			// opaque image payload alongside it. This is for custom tools that
			// understand { image_ref, image }.
			if (key === "image_ref") {
				if (
					typeof obj["image"] !== "object" ||
					obj["image"] === null ||
					Array.isArray(obj["image"])
				) {
					obj["image"] = {
						name: resolved.name,
						mime: resolved.mime,
						base64: resolved.base64,
					};
				}
				continue;
			}

			// Heuristic for third-party tools (e.g. Hugging Face Spaces via MCP)
			// that expect a string URL in an image input field such as "input_image".
			// When the model sets that field to "latest" / "image_1" / etc.,
			// rewrite it to a data: URL so the remote tool sees a real image
			// while the model only ever saw the short ref string.
			if (key === "input_image") {
				obj[key] = `data:${resolved.mime};base64,${resolved.base64}`;
				continue;
			}
		}
	};

	visit(argsObj);
}
