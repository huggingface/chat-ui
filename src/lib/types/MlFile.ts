import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";

/**
 * one version of a virtual file, files belong to the conversation not a branch, every
 * write or edit is a new document and the latest is the highest version
 */
export interface MlFile {
	_id: ObjectId;
	conversationId: Conversation["_id"];
	name: string;
	/** 1 based, unique with conversationId and name */
	version: number;
	content: string;
	/** utf8 bytes of content */
	size: number;
	sha256: string;
	origin: "write" | "edit" | "import";
	/** what an import read, the sandbox handle and path or the hf:// uri */
	source?: string;
	createdAt: Date;
	messageId?: Message["id"];
	generationId?: string;
	/** uuid of the tool call that produced this version */
	toolUuid?: string;
	/** one line the model gave */
	summary?: string;
	/** label of the sub-agent whose run wrote this version, absent for the parent loop */
	agent?: string;
}

/** the latest version of a file by name, without its content */
export interface MlFileListing {
	name: string;
	/** the latest version, also how many exist */
	version: number;
	size: number;
	updatedAt: Date;
	summary?: string;
}

/** a virtual file version named by a job that ran it or a hub file written from it */
export interface MlFileRef {
	name: string;
	version: number;
}

/** one version without its content, as the files endpoint lists it */
export type MlFileVersionListing = Pick<
	MlFile,
	"version" | "size" | "origin" | "source" | "agent" | "summary" | "createdAt" | "messageId"
>;

export interface MlFileVersions {
	name: string;
	/** newest first */
	versions: MlFileVersionListing[];
}

/** what the files endpoint returns for one version */
export interface MlFileVersionContent extends MlFileVersionListing {
	name: string;
	content: string;
}
