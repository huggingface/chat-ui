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

export function getContextFromNodes(
	rootNodes: WebResultNode[],
	leadNodes: Record<number, WebResultNode>,
	indices: number[]
): string {
	const ragContent: string[] = [];
	// 1. label the nodes
	for (const idx of indices) {
		leadNodes[idx].isSelected = true;
	}
	// 2. if both siblings are selected, then mark the node as selected as well
	for (const node of Object.values(leadNodes)) {
		if (node.leftSibling?.isSelected && node.rightSibling?.isSelected) {
			node.isSelected = true;
		}
	}
	// 3. label them if children are n greener n shit
	for (const node of rootNodes) {
		postOrderSelect(node);
	}
	// 4. get the top down node green and return the string context
	const stack = [...rootNodes];

	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) {
			continue;
		}
		if (node.isSelected) {
			console.log("NODE SIZE", node.content.length, !!node.children);
			if (node.children) {
				console.log(JSON.stringify(node, null, 2));
			}
			ragContent.push(node.content);
		} else if (node.children && node.children.length > 0) {
			stack.push(...node.children);
		}
	}

	return ragContent.join(" ");
}

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

	node.isSelected = selectedChildrenCount / totalChildren > 0.5;
	return node.isSelected;
}
