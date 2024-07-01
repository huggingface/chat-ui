import type { ObjectId } from "mongodb";
import type { User } from "./User";
import type { Timestamps } from "./Timestamps";
import type { BackendToolContext } from "$lib/server/tools";
import type { MessageUpdate } from "./MessageUpdate";

export type ToolLogoColor = "purple" | "blue" | "green" | "yellow" | "red";
export type ToolLogoIcon =
	| "wikis"
	| "tools"
	| "camera"
	| "code"
	| "email"
	| "cloud"
	| "terminal"
	| "game"
	| "chat"
	| "speaker"
	| "video";

export type ToolIOType = "str" | "int" | "float" | "boolean" | "file";

export type ToolInputRequired = {
	paramType: "required";
	name: string;
	description?: string;
};

export type ToolInputOptional = {
	paramType: "optional";
	name: string;
	description?: string;
	default: string | number | boolean;
};

export type ToolInputFixed = {
	paramType: "fixed";
	name: string;
	value: string | number | boolean;
};

type ToolInputBase = ToolInputRequired | ToolInputOptional | ToolInputFixed;

export type ToolInputFile = ToolInputBase & {
	type: "file";
	mimeTypes: string[];
};

export type ToolInputSimple = ToolInputBase & {
	type: Exclude<ToolIOType, "file">;
};

export type ToolInput = ToolInputFile | ToolInputSimple;

export interface BaseTool {
	_id: ObjectId;

	name: string; // name that will be shown to the AI

	baseUrl?: string; // namespace for the tool
	endpoint: string | null; // endpoint to call in gradio, if null we expect to override this function in code
	outputPath: string | null; // JSONPath to the output in the response, if null we expect the function to be overriden in the code somewhere

	inputs: Array<ToolInput>;
	outputType: ToolIOType; // type of the output
	outputMimeType?: string; // mime type of the output
	showOutput: boolean; // show output in chat or not

	call: BackendCall;

	// for displaying in the UI
	displayName: string;
	color: ToolLogoColor;
	icon: ToolLogoIcon;
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

	createdById: User["_id"] | string; // user id or session
	createdByName?: User["username"];

	// used to compute popular & trending
	useCount: number;
	last24HoursUseCount: number;

	featured: boolean;
	searchTokens: string[];
}

// no call function in db
export type CommunityToolDB = Omit<CommunityTool, "call">;

export type CommunityToolEditable = Omit<
	CommunityToolDB,
	| "_id"
	| "useCount"
	| "last24HoursUseCount"
	| "createdById"
	| "createdByName"
	| "featured"
	| "searchTokens"
	| "type"
	| "createdAt"
	| "updatedAt"
>;

export type Tool = ConfigTool | CommunityTool;

export type ToolFront = Pick<Tool, "type" | "name" | "displayName" | "description"> & {
	_id: string;
	isOnByDefault: boolean;
	isLocked: boolean;
	mimeTypes: string[];
	timeToUseMS?: number;
};

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
