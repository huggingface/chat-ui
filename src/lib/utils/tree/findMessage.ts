import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";

export function findMessage(
	conv: Pick<Conversation, "_id" | "branches" | "messages">,
	id: Message["id"]
): Message {
	// first find the parent branch, either "messages" or a branch where branch.parents is an empty array
	// then perform BFS to find the message ID in the tree.

	const baseBranch = conv.messages
		? {
				_id: conv._id,
				parents: [],
				messages: conv.messages,
		  }
		: conv.branches?.find((b) => b.parents.length === 0);

	if (!baseBranch) throw new Error("No base branch found");

	// perform search
	// each message in messages can have references to other branches
	// they will need to be found by id though.

	const queue = [baseBranch];

	while (queue.length > 0) {
		const branch = queue.shift();
		const message = branch?.messages?.find((m) => m.id === id);
		if (message) return message;

		// add all the children to the queue
		for (const childId of branch?.messages?.flatMap((m) => m.branches) ?? []) {
			const childBranch = conv.branches?.find((b) => b._id === childId);
			if (childBranch) queue.push(childBranch);
		}
	}
	throw new Error("Message not found");
}
