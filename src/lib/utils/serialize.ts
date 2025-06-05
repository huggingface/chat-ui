import type { ObjectId } from "mongodb";

export type Serialize<T> = T extends ObjectId | Date
	? string
	: T extends Array<infer U>
		? Array<Serialize<U>>
		: T extends object
			? { [K in keyof T]: Serialize<T[K]> }
			: T;

export function jsonSerialize<T>(data: T): Serialize<T> {
	return JSON.parse(JSON.stringify(data)) as Serialize<T>;
}
