import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makeImageProcessor } from "./images";

const imageProcessor = makeImageProcessor({
	supportedMimeTypes: ["image/png", "image/jpeg"],
	preferredMimeType: "image/jpeg",
	maxSizeInMB: 1,
	maxWidth: 1024,
	maxHeight: 1024,
});

describe("makeImageProcessor", () => {
	it("rejects SVG content declared as image/png", async () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>`;

		await expect(
			imageProcessor({
				type: "base64",
				name: "image.png",
				mime: "image/png",
				value: Buffer.from(svg).toString("base64"),
			})
		).rejects.toThrow("unsupported image format");
	});

	it("accepts PNG content declared as image/png", async () => {
		const png = await sharp({
			create: {
				width: 1,
				height: 1,
				channels: 4,
				background: { r: 255, g: 0, b: 0, alpha: 1 },
			},
		})
			.png()
			.toBuffer();

		const result = await imageProcessor({
			type: "base64",
			name: "image.png",
			mime: "image/png",
			value: png.toString("base64"),
		});

		expect(result.mime).toBe("image/png");
		expect(result.image.subarray(1, 4).toString()).toBe("PNG");
	});
});
