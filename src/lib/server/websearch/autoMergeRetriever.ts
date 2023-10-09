/**
 * Based on https://gpt-index.readthedocs.io/en/v0.8.41/examples/retrievers/auto_merging_retriever.html
 * Read this twitter thread for comprehensive description: https://twitter.com/clusteredbytes/status/1707864519433736305
 * See `getRagContext` function comments
 */
import { chunk } from "$lib/utils/chunk";
import type { WebResultNode } from "$lib/types/WebSearch";

/**
 * Given a node & chunkSizes, create children rescursively.
 * Example: give nodeA (whose content length is 512 words) & chunkSizes [512, 256, 128],
 * then, nodeA will have two children (each with content length of 256 words),
 * and each children of nodeA will have two children (each with content length of 128 words).
 */
export function createChildren(node: WebResultNode, chunkSizes: number[]): WebResultNode {
	if (chunkSizes.length === 0 || node.content.length === 0) {
		return node;
	}

	const [firstLength, ...restLengths] = chunkSizes;
	const { source } = node;
	const parts = chunk(node.content, firstLength, "words");
	node.children = parts.map((part) => {
		const child: WebResultNode = { content: part, source };
		return createChildren(child, restLengths);
	});
	for (let i = 0; i < node.children.length; i++) {
		node.children[i].leftSibling = node.children[i - 1];
		node.children[i].rightSibling = node.children[i + 1];
	}

	return node;
}

export function getLeafNodes(nodes: WebResultNode[]): Record<number, WebResultNode> {
	const leafNodes: Record<number, WebResultNode> = {};
	let counter = 0;
	const stack = [...nodes];

	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) {
			continue;
		}
		if (node.children && node.children.length > 0) {
			stack.push(...node.children);
		} else {
			node.id = counter;
			leafNodes[counter] = node;
			counter++;
		}
	}

	return leafNodes;
}

export function getRagContext(
	rootNodes: WebResultNode[],
	leadNodes: Record<number, WebResultNode>,
	indices: number[]
): string {
	const ragContext: string[] = [];
	// 1. select leaf nodes based on `indices` (`indices` come from `findSimilarSentences` embeddings search function)
	for (const idx of indices) {
		leadNodes[idx].isSelected = true;
	}
	// 2. for a leaf node, if both left and right siblings are selected, then the node should be selected as well
	for (const node of Object.values(leadNodes)) {
		if (node.leftSibling?.isSelected && node.rightSibling?.isSelected) {
			node.isSelected = true;
		}
	}
	// 3. select nodes that have enough selected children
	// this is the dynamic k-part of AutoMergeRetriever algorithm
	for (const node of rootNodes) {
		postOrderSelect(node);
	}
	// 4. get RAG context by combining contents of all selected nodes
	const stack = [...rootNodes];
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) {
			continue;
		}
		if (node.isSelected) {
			ragContext.push(node.content);
		} else if (node.children && node.children.length > 0) {
			stack.push(...node.children);
		}
	}
	return ragContext.join(" ");
}

const THRESHOLD_TO_SELECT = 0.5 as const;
/**
 * Select a nodeA if nodeA has enough selected children based on `THRESHOLD_TO_SELECT`
 */
function postOrderSelect(node: WebResultNode | null): boolean {
	if (node == null) {
		return false;
	} else if (node.isSelected) {
		return true;
	}

	let selectedChildrenCount = 0;
	const totalChildren = node?.children?.length ?? 0;

	if (node.children) {
		for (const child of node.children) {
			const isChildSelected = postOrderSelect(child);
			if (isChildSelected) {
				selectedChildrenCount++;
			}
		}
	}

	node.isSelected = selectedChildrenCount / totalChildren > THRESHOLD_TO_SELECT;
	return node.isSelected;
}
