import type { ObjectId } from "mongodb";

export interface MigrationResult<TData = unknown> {
	_id: ObjectId;
	name: string;
	status: "success" | "failure" | "ongoing";
	data?: TData;
}
