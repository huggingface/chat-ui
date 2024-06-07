import * as base64 from "base64-js"; // You might need to install base64-js or use a different base64 library depending on your environment

interface EncodedTensor {
	dtype: string;
	data: string;
	shape: number[];
}

export function encodedTensorToTensor(
	encodedTensor: EncodedTensor
): [Float32Array | Int32Array | Uint8Array, number[]] {
	// Map the stored dtype string back to a specific TypedArray constructor
	const dtypeMap: { [key: string]: any } = {
		"torch.float32": Float32Array,
		"torch.int32": Int32Array,
		"torch.bool": Uint8Array, // JavaScript does not have a boolean typed array, so using Uint8Array as a workaround
		// Add more mappings as needed for different tensor dtypes
	};

	const TypedArrayConstructor = dtypeMap[encodedTensor["dtype"]];
	if (!TypedArrayConstructor) {
		throw new Error(`Unsupported dtype: ${encodedTensor["dtype"]}`);
	}

	// Decode the base64 string to a byte array (Uint8Array)
	const decodedBytes = base64.toByteArray(encodedTensor.data);
	// Convert byte array to a typed array with the original dtype
	// Note: This step involves copying the data. For large arrays, consider optimizing.
	const arrayBuffer = decodedBytes.buffer.slice(
		decodedBytes.byteOffset,
		decodedBytes.byteOffset + decodedBytes.byteLength
	);
	const typedArray = new TypedArrayConstructor(arrayBuffer);

	return [typedArray, encodedTensor.shape];
}

export function tensorToMasksCanvas(
	tensor: Float32Array | Int32Array | Uint8Array,
	shape: number[]
): HTMLImageElement[] {
	// Assuming shape = [number of masks, width, height]
	const [numMasks, height, width] = shape;
	const masksCanvas: HTMLImageElement[] = [];

	for (let i: number = 0; i < numMasks; i++) {
		// Create a new canvas for each mask
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");

		if (!ctx) {
			throw new Error("Unable to get canvas context");
		}

		// Create an ImageData object to hold the mask
		const imageData = ctx.createImageData(width, height);

		// Fill the imageData.data from the tensor slice corresponding to the current mask
		for (let j = 0; j < width * height; j++) {
			const tensorIndex = i * width * height + j;
			const intensity = tensor[tensorIndex];
			if (intensity > 0) {
				const pixelIndex = j * 4;
				imageData.data[pixelIndex] = intensity * colorList[i % colorList.length][0]; // R
				imageData.data[pixelIndex + 1] = intensity * colorList[i % colorList.length][1]; // G
				imageData.data[pixelIndex + 2] = intensity * colorList[i % colorList.length][2]; // B
				imageData.data[pixelIndex + 3] = 255; // A (fully opaque)
			}
		}

		// Draw the imageData onto the canvas
		ctx.putImageData(imageData, 0, 0);
		const image = new Image();
		image.src = canvas.toDataURL();

		// Add the canvas to the masksCanvas array
		masksCanvas.push(image);
	}

	return masksCanvas;
}
export function tensorToHeatmapCanvas(tensor, shape) {
	const [height, width] = shape; // Assuming a 2D shape for simplicity
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");

	if (!ctx) {
		throw new Error("Unable to get canvas context");
	}
	function intensityToViridisColor(intensity) {
		// Normalize intensity to a 0-1 scale
		const normalizedIntensity = intensity / 255;

		// Viridis key colors from dark blue to yellow
		const colors = [
			// { r: 25, g: 0, b: 51 }, // Dark Blue
			// { r: 64, g: 67, b: 135 }, // Indigo
			// { r: 34, g: 167, b: 132 }, // Cyan
			// { r: 121, g: 209, b: 81 }, // Green
			// { r: 253, g: 231, b: 37 }, // Yellow
			{ r: 13, g: 0, b: 28 }, // Very Dark Purple
			{ r: 25, g: 0, b: 51 }, // Dark Blue
			{ r: 44, g: 33, b: 93 }, // Deep Purple Blue
			{ r: 64, g: 67, b: 135 }, // Bluish Green
			{ r: 34, g: 167, b: 132 }, // Cyan
			{ r: 78, g: 188, b: 106 }, // Greenish Cyan
			{ r: 121, g: 209, b: 81 }, // Green
			{ r: 187, g: 220, b: 59 }, // Lime Green
			{ r: 253, g: 231, b: 37 }, // Yellow
			{ r: 255, g: 174, b: 0 }, // Orange
		];

		// Determine which two colors to interpolate between
		const fraction = (colors.length - 1) * normalizedIntensity;
		const index = Math.floor(fraction);
		const remainder = fraction - index;

		// Ensure index is within bounds
		const startIndex = Math.min(index, colors.length - 2);
		const endIndex = Math.min(index + 1, colors.length - 1);

		// Interpolate between the two selected colors
		const startColor = colors[startIndex];
		const endColor = colors[endIndex];
		const r = startColor.r + (endColor.r - startColor.r) * remainder;
		const g = startColor.g + (endColor.g - startColor.g) * remainder;
		const b = startColor.b + (endColor.b - startColor.b) * remainder;

		// Return the interpolated color as an RGB string
		return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
	}
	// Function to map tensor values to color intensity
	const getColor = (value) => {
		const intensity = Math.min(255, Math.max(0, Math.floor(value * 255)));
		// return `rgb(${intensity}, ${intensity}, ${intensity})`; // Grayscale intensity
		return intensityToViridisColor(intensity);
	};

	// Fill the canvas based on tensor values
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const value = tensor[y * width + x];
			ctx.fillStyle = getColor(value);
			ctx.fillRect(x, y, 1, 1); // Fill in each pixel
		}
	}

	// Add interactivity, for example, log value on mouse move
	canvas.addEventListener("mousemove", function (event) {
		const rect = canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		const tensorValue = tensor[Math.floor(y) * width + Math.floor(x)];
		console.log(`Value at (${x}, ${y}): ${tensorValue}`);
		// You can also display this information on the page instead of just logging it
	});

	return canvas.toDataURL("image/png");
}

export function tensorToMask(
	tensor: Float32Array | Int32Array | Uint8Array,
	shape: number[]
): string {
	// Assuming shape = [number of masks, width, height]
	const [height, width] = shape;

	// Create a new canvas for each mask
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");

	if (!ctx) {
		throw new Error("Unable to get canvas context");
	}

	// Create an ImageData object to hold the mask
	const imageData = ctx.createImageData(width, height);

	// Fill the imageData.data from the tensor slice corresponding to the current mask
	for (let j: number = 0; j < width * height; j++) {
		const tensorIndex = j;
		const intensity = tensor[tensorIndex] * 255; // Assuming the tensor values are normalized [0, 1]
		const pixelIndex = j * 4;
		imageData.data[pixelIndex] = intensity * colorList[i % colorList.length][0]; // R
		imageData.data[pixelIndex + 1] = intensity * colorList[i % colorList.length][1]; // G
		imageData.data[pixelIndex + 2] = intensity * colorList[i % colorList.length][2]; // B
		imageData.data[pixelIndex + 3] = 255; // A (fully opaque)
	}

	// Draw the imageData onto the canvas
	ctx.putImageData(imageData, 0, 0);
	return canvas.toDataURL("image/png");
}
export function checkPointInMask(
	tensor: Float32Array | Int32Array | Uint8Array,
	shape: number[],
	x: number,
	y: number
) {
	const [numMasks, height, width] = shape;
	const maskIndexes = [];
	for (let i = 0; i < numMasks; i++) {
		const tensorIndex = i * width * height + y * width + x;
		if (tensor[tensorIndex] > 0) {
			maskIndexes.push(i);
		}
	}
	return maskIndexes;
}
export function getMaskByIndex(
	tensor: Float32Array | Int32Array | Uint8Array,
	shape: number[],
	index: number
) {
	const [numMasks, height, width] = shape;
	const mask = new Uint8Array(height * width);
	for (let i = 0; i < height * width; i++) {
		mask[i] = tensor[index * height * width + i];
	}
	return mask;
}

export function encodedTensorToMasksCanvas(encodedTensor: EncodedTensor): HTMLCanvasElement[] {
	const [tensor, shape] = encodedTensorToTensor(encodedTensor);
	return tensorToMasksCanvas(tensor, shape);
}
export function maskingImage(image: HTMLImageElement, mask: HTMLImageElement) {
	const canvas = document.createElement("canvas");
	canvas.width = image.width;
	canvas.height = image.height;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		throw new Error("Unable to get canvas context");
	}
	ctx.drawImage(image, 0, 0);
	ctx.globalCompositeOperation = "destination-in";
	ctx.drawImage(mask, 0, 0);
	const topLeft = {
		x: canvas.width,
		y: canvas.height,
		update(x, y) {
			this.x = Math.min(this.x, x);
			this.y = Math.min(this.y, y);
		},
	};

	const bottomRight = {
		x: 0,
		y: 0,
		update(x, y) {
			this.x = Math.max(this.x, x);
			this.y = Math.max(this.y, y);
		},
	};
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

	for (let x = 0; x < canvas.width; x++) {
		for (let y = 0; y < canvas.height; y++) {
			const alpha = imageData.data[y * (canvas.width * 4) + x * 4 + 3];
			if (alpha !== 0) {
				topLeft.update(x, y);
				bottomRight.update(x, y);
			}
		}
	}
	const width = bottomRight.x - topLeft.x;
	const height = bottomRight.y - topLeft.y;
	const croppedCanvas = ctx.getImageData(topLeft.x, topLeft.y, width, height);
	canvas.width = width;
	canvas.height = height;
	ctx.putImageData(croppedCanvas, 0, 0);
	return canvas.toDataURL("image/png");
}

const colorList: number[][] = [
	[255, 0, 0], // Red
	[0, 255, 0], // Lime
	[0, 0, 255], // Blue
	[255, 255, 0], // Yellow
	[0, 255, 255], // Cyan
	[255, 0, 255], // Magenta
	[192, 192, 192], // Silver
	[128, 0, 0], // Maroon
	[128, 128, 0], // Olive
	[0, 128, 0], // Green
	[128, 0, 128], // Purple
	[0, 128, 128], // Teal
	[0, 0, 128], // Navy
	[255, 165, 0], // Orange
	[255, 105, 180], // Hot Pink
	[75, 0, 130], // Indigo
	[255, 192, 203], // Pink
	[64, 224, 208], // Turquoise
	[112, 128, 144], // Slate Gray
	[255, 69, 0], // Red-Orange
	[153, 50, 204], // Dark Orchid
	[255, 215, 0], // Gold
	[0, 100, 0], // Dark Green
	[139, 69, 19], // Saddle Brown
	[70, 130, 180], // Steel Blue
	[210, 105, 30], // Chocolate
	[220, 20, 60], // Crimson
	[95, 158, 160], // Cadet Blue
	[102, 205, 170], // Medium Aquamarine
	[176, 224, 230], // Powder Blue
];
