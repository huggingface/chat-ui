import { error, type RequestHandler } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { resolveConversation } from "$lib/server/api/utils/resolveConversation";
import { listMlFileVersions, readMlFile, toMlFileVersionListing } from "$lib/server/mlFiles/store";
import type { MlFileVersionContent, MlFileVersions } from "$lib/types/MlFile";

const VERSION = /^[1-9]\d*$/;

export const GET: RequestHandler = async ({ locals, params, url }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	// a share snapshot has no files of its own, and its reader is not the owner
	if (id.length === 7) error(404, "Conversation not found");

	const conversation = await resolveConversation(id, locals);
	const conversationId = new ObjectId(conversation._id);
	const name = params.name ?? "";

	const version = url.searchParams.get("version");
	if (version === null) {
		const versions = await listMlFileVersions(conversationId, name);
		if (versions.length === 0) error(404, "File not found");
		return superjsonResponse({ name, versions } satisfies MlFileVersions);
	}

	if (!VERSION.test(version)) error(400, "version must be a positive integer");
	const file = await readMlFile(conversationId, name, Number(version));
	if (!file) error(404, "File version not found");
	return superjsonResponse({
		name: file.name,
		...toMlFileVersionListing(file),
		content: file.content,
	} satisfies MlFileVersionContent);
};
