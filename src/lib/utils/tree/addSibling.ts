import { v4 } from "uuid";
import type { Tree, TreeId, NewNode, TreeNode } from "./tree";

export function addSibling<T>(conv: Tree<T>, message: NewNode<T>, siblingId: TreeId): TreeId {
	if (conv.messages.length === 0) {
		throw new Error("Cannot add a sibling to an empty conversation");
	}
	if (!conv.rootMessageId) {
		throw new Error("Cannot add a sibling to a legacy conversation");
	}

	const sibling = conv.messages.find((m) => m.id === siblingId);

	if (!sibling) {
		throw new Error("The sibling message doesn't exist");
	}

	const messageId = v4();

	const siblingAncestors = sibling.ancestors ?? [];

	conv.messages.push({
		...message,
		id: messageId,
		ancestors: siblingAncestors,
		children: [],
	} as TreeNode<T>);

	const nearestAncestorId = siblingAncestors[siblingAncestors.length - 1];
	const nearestAncestor = conv.messages.find((m) => m.id === nearestAncestorId);

	if (nearestAncestor) {
		if (nearestAncestor.children) {
			nearestAncestor.children.push(messageId);
		} else nearestAncestor.children = [messageId];
	}

	return messageId;
}
