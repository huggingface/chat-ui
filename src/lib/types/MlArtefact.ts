import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";
import type { MlRegistryOrigin, MlService } from "./MlService";
import type { Timestamps } from "./Timestamps";

export type MlArtefactKind = "model" | "dataset" | "space" | "bucket" | "file" | "dashboard";

/**
 * spelled artefact because artifact already names the side pane object in utils/artifacts.ts
 * unique per conversation and uri, a second write to the same path updates the row
 */
export interface MlArtefact extends Timestamps {
	_id: ObjectId;
	conversationId: Conversation["_id"];
	kind: MlArtefactKind;
	/** hf://<models|datasets|spaces|buckets>/<owner>/<name>[/<path>] */
	uri: string;
	url: string;
	origin: MlRegistryOrigin;
	/** latest commit that wrote it, files only */
	commit?: string;
	serviceId?: MlService["_id"];
	messageId?: Message["id"];
	generationId?: string;
	/** the dispatch uuid, not the provider tool call id */
	toolUuid?: string;
}
