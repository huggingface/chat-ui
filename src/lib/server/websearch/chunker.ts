import { chunk } from "$lib/utils/chunk";
import type { WebResultNode } from "$lib/types/WebSearch";

export function createChildren(node: WebResultNode, lengths: number[]): WebResultNode {
	if (lengths.length === 0 || node.content.length === 0) {
		return node;
	}

	const [firstLength, ...restLengths] = lengths;
	if (firstLength <= 0) {
		throw new Error("Lengths should be positive integers.");
	}

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

export function getLeafNodes(nodes: WebResultNode[]): WebResultNode[] {
	const leafNodes: WebResultNode[] = [];
	const stack = [...nodes];

	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) {
			continue;
		}
		if (node.children && node.children.length > 0) {
			stack.push(...node.children);
		} else {
			leafNodes.push(node);
		}
	}

	return leafNodes;
}
