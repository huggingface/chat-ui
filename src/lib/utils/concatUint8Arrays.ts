import { sum } from "./sum";

export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
	const totalLength = sum(arrays.map((a) => a.length));
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const array of arrays) {
		result.set(array, offset);
		offset += array.length;
	}
	return result;
}
