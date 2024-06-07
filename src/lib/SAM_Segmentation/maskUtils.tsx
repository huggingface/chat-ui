// Copyright (c) Meta Platforms, Inc. and affiliates.
// All rights reserved.

// This source code is licensed under the license found in the
// LICENSE file in the root directory of this source tree.
// Convert the onnx model mask prediction to ImageData
export function arrayToMask(input: any, width: number, height: number) {
	const arr: Array<number> = [];
	for (let i = 0; i < input.length; i++) {
		// Threshold the onnx model mask prediction at 0.0
		// This is equivalent to thresholding the mask using predictor.model.mask_threshold
		// in python
		if (input[i] > 0.0) {
			arr.push(1);
		} else {
			arr.push(0);
		}
	}
	return { arr, width, height };
}
export function arrayToImageData(input: any, width: number, height: number) {
	const [r, g, b, a] = [0, 114, 189, 255]; // the masks's blue color
	const arr = new Uint8ClampedArray(4 * width * height).fill(0);
	for (let i = 0; i < input.length; i++) {
		// Threshold the onnx model mask prediction at 0.0
		// This is equivalent to thresholding the mask using predictor.model.mask_threshold
		// in python
		if (input[i] > 0.0) {
			arr[4 * i + 0] = r;
			arr[4 * i + 1] = g;
			arr[4 * i + 2] = b;
			arr[4 * i + 3] = a;
		}
	}
	return new ImageData(arr, height, width);
}
export function ImageDataToArray(imageData: ImageData) {
	const arr = new Uint8ClampedArray(4 * imageData.width * imageData.height).fill(0);
	for (let i = 0; i < imageData.data.length; i++) {
		arr[i] = imageData.data[i];
	}
	const width = imageData.width;
	const height = imageData.height;
	return { arr, width, height };
}

// Use a Canvas element to produce an image from ImageData
export function imageDataToImage(imageData: ImageData) {
	const canvas = imageDataToCanvas(imageData);
	const image = new Image();
	image.src = canvas.toDataURL();
	return image;
}

// Canvas elements can be created from ImageData
function imageDataToCanvas(imageData: ImageData) {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	canvas.width = imageData.width;
	canvas.height = imageData.height;
	ctx?.putImageData(imageData, 0, 0);
	return canvas;
}

// Convert the onnx model mask output to an HTMLImageElement
export function onnxMaskToImage(input: any, width: number, height: number) {
	return imageDataToImage(arrayToImageData(input, width, height));
}

function rleCompress(binaryArr: Array<number>) {
	const compressed: Array<number> = [];
	let current = binaryArr[0];
	let count = 1;
	for (let i = 1; i < binaryArr.length; i++) {
		if (binaryArr[i] === current) {
			count++;
		} else {
			compressed.push(current);
			compressed.push(count);
			current = binaryArr[i];
			count = 1;
		}
	}
	compressed.push(current);
	compressed.push(count);
	return compressed;
}

export function compressor(byteArray) {
	// Apply RLE Compression
	const compressed = rleCompress(byteArray);
	return compressed;
}

function rleDecompress(compresseArr: Array<number>) {
	const decompressed: Array<number> = [];
	for (let i = 0; i < compresseArr.length; i += 2) {
		decompressed.push(...Array(compresseArr[i + 1]).fill(compresseArr[i]));
	}
	return decompressed;
}

export function decompressor(array) {
	// // Decompress the Base64 String

	return rleDecompress(array);
}
