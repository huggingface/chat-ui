import type { AnyBulkWriteOperation } from "mongodb";
import type { Assistant } from "$lib/types/Assistant";
import { generateSearchTokens } from "$lib/utils/searchTokens";
import { collections } from "./database";

async function refreshSearchTokens() {
	console.log("Refreshing assistants search tokens started...");
	let ops: AnyBulkWriteOperation<Assistant>[] = [];
	for await (const assistant of collections.assistants
		.find()
		.project<Pick<Assistant, "_id" | "name">>({ _id: 1, name: 1 })) {
		ops.push({
			updateOne: {
				filter: {
					_id: assistant._id,
				},
				update: {
					$set: {
						searchTokens: generateSearchTokens(assistant.name),
					},
				},
			},
		});

		if (ops.length >= 1000) {
			process.stdout.write(".");
			await collections.assistants.bulkWrite(ops, { ordered: false });
			ops = [];
		}
	}

	if (ops.length) {
		await collections.assistants.bulkWrite(ops, { ordered: false });
	}

	console.log("Refreshing assistants search tokens done");
}

const migrationFunctions: Record<string, () => Promise<void>> = {
	refreshSearchTokens,
};

export default migrationFunctions;
