import { sentences as splitBySentences } from "sbd";
import { MarkdownElementType, type MarkdownElement } from "../types";

export function chunkElements(elements: MarkdownElement[], maxLength: number): MarkdownElement[] {
	return elements.flatMap((elem) => {
		// Can't split headers because it would break the tree, and this situation should be rare
		// so we just cut off the end
		if (elem.type === MarkdownElementType.Header) {
			return { ...elem, content: elem.content.slice(0, maxLength) };
		}
		const contentChunks = enforceMaxLength(elem.content, maxLength);
		return contentChunks.map<MarkdownElement>((content) => ({ ...elem, content }));
	});
}

const delimitersByPriority = ["?", "!", ".", ";", ":", ",", "|", " - ", " ", "-"];
function enforceMaxLength(text: string, maxLength: number): string[] {
	if (text.length <= maxLength) return [text].filter(Boolean);
	return splitBySentences(text)
		.flatMap((sentence) => {
			if (sentence.length <= maxLength) return sentence;

			// Discover all necessary split points to fit the sentence within the max length
			const indices: [number, number][] = [];
			while ((indices.at(-1)?.[1] ?? 0) < sentence.length) {
				const prevIndex = indices.at(-1)?.[1] ?? 0;

				// Remaining text fits within maxLength
				if (prevIndex + maxLength >= sentence.length) {
					indices.push([prevIndex, sentence.length]);
					continue;
				}

				const bestDelimiter = delimitersByPriority.find(
					(delimiter) => sentence.lastIndexOf(delimiter, prevIndex + maxLength) !== -1
				);
				// Fallback in the unusual case that no delimiter is found
				if (!bestDelimiter) {
					indices.push([prevIndex, prevIndex + maxLength]);
					continue;
				}

				const closestDelimiter = sentence.lastIndexOf(bestDelimiter, prevIndex + maxLength);
				indices.push([prevIndex, Math.max(prevIndex + 1, closestDelimiter)]);
			}

			return indices.map((sliceIndices) => sentence.slice(...sliceIndices));
		})
		.reduce<string[]>(
			(chunks, sentence) => {
				const lastChunk = chunks[chunks.length - 1];
				if (lastChunk.length + sentence.length <= maxLength) {
					return [...chunks.slice(0, -1), lastChunk + sentence];
				}
				return [...chunks, sentence];
			},
			[""]
		)
		.filter(Boolean);
}
