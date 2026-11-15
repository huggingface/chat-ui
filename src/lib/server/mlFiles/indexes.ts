import type { CreateIndexesOptions, IndexSpecification } from "mongodb";

/**
 * unique so two concurrent writes of one name cannot both take a version, compound so
 * the latest version read is one index seek, shared with the specs that rely on the
 * uniqueness because initDatabase builds it in the background
 */
export const ML_FILE_VERSION_INDEX: { keys: IndexSpecification; options: CreateIndexesOptions } = {
	keys: { conversationId: 1, name: 1, version: -1 },
	options: { unique: true },
};
