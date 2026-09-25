import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";
import type { MlFileRef } from "./MlFile";
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
	/** latest commit that wrote it, a put for a file or a job push for a repo */
	commit?: string;
	/** the virtual file version that latest commit uploaded, files only */
	fromFile?: MlFileRef;
	/** the job that pushed to it */
	serviceId?: MlService["_id"];
	messageId?: Message["id"];
	generationId?: string;
	/** the dispatch uuid, not the provider tool call id */
	toolUuid?: string;
}
