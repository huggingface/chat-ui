import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";

export interface RagContext extends Timestamps {
	_id?: ObjectId;
	convId?: Conversation["_id"];
	type: RAGType
	context: string;
}

export const ragTypes = ["webSearch", "pdfChat"];

export type RAGType = (typeof ragTypes)[number];
