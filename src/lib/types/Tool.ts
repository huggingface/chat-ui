import type { ObjectId } from "mongodb";
import type { User } from "./User";
import type { Timestamps } from "./Timestamps";
import type { BackendToolContext } from "$lib/server/tools";
import type { MessageUpdate } from "./MessageUpdate";

export type ToolIOType = "str" | "int" | "float" | "boolean" | "file";

type ToolInputBase = {
	description: string; // description of the input, shown to the AI
	required: boolean; // is the input required
	default?: string | number | boolean; // default value if not provided
};

export type ToolInput =
	| (ToolInputBase & {
			type: Exclude<ToolIOType, "file">;
	  })
	| (ToolInputBase & {
			type: "file";
			mimeTypes: string[];
	  });

export interface ToolFunction {
	name: string; // name that will be shown to the AI
	displayName: string; // name that will be shown to the user

	description: string;
	endpoint: string | null; // endpoint to call in gradio, if null we expect to override this function in code

	inputs: Record<string, ToolInput>;

	outputPath: string | null; // JSONPath to the output in the response, if null we expect the function to be overriden in the code somewhere
	outputType: ToolIOType; // type of the output
	outputMimeType?: string; // mime type of the output
	showOutput: boolean; // show output in chat or not

	call: BackendCall;
}

export interface BaseTool {
	// tool can have multiple functions that get added/removed as a group
	functions: ToolFunction[];

	// for displaying in the UI
	displayName: string;
	color: string;
	icon: string;
	description: string;
}

export interface ConfigTool extends BaseTool {
	type: "config";
	isOnByDefault?: true;
	isLocked?: true;
	isHidden?: true;
}

export interface CommunityTool extends BaseTool, Timestamps {
	type: "community";

	_id: ObjectId;
	createdById: User["_id"] | string; // user id or session
	createdByName?: User["username"];

	// used to compute popular & trending
	useCount: number;
	last24HoursUseCount: number;
}

export type Tool = ConfigTool | CommunityTool;

export type ToolFront = (
	| Pick<ConfigTool, "type" | "displayName" | "description" | "isOnByDefault" | "isLocked">
	| Pick<CommunityTool, "type" | "displayName" | "description">
) & { timeToUseMS?: number };

export enum ToolResultStatus {
	Success = "success",
	Error = "error",
}
export interface ToolResultSuccess {
	status: ToolResultStatus.Success;
	call: ToolCall;
	outputs: Record<string, unknown>[];
	display?: boolean;
}
export interface ToolResultError {
	status: ToolResultStatus.Error;
	call: ToolCall;
	message: string;
	display?: boolean;
}
export type ToolResult = ToolResultSuccess | ToolResultError;

export interface ToolCall {
	name: string;
	parameters: Record<string, string | number | boolean>;
}

export type BackendCall = (
	params: Record<string, string | number | boolean>,
	context: BackendToolContext
) => AsyncGenerator<MessageUpdate, Omit<ToolResultSuccess, "status" | "call" | "type">, undefined>;
