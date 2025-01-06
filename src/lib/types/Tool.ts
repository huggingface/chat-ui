import type { ObjectId } from "mongodb";
import type { User } from "./User";
import type { Timestamps } from "./Timestamps";
import type { BackendToolContext } from "$lib/server/tools";
import type { MessageUpdate } from "./MessageUpdate";
import { z } from "zod";
import type { ReviewStatus } from "./Review";

export const ToolColor = z.union([
	z.literal("purple"),
	z.literal("blue"),
	z.literal("green"),
	z.literal("yellow"),
	z.literal("red"),
]);

export const ToolIcon = z.union([
	z.literal("wikis"),
	z.literal("tools"),
	z.literal("camera"),
	z.literal("code"),
	z.literal("email"),
	z.literal("cloud"),
	z.literal("terminal"),
	z.literal("game"),
	z.literal("chat"),
	z.literal("speaker"),
	z.literal("video"),
]);

export const ToolOutputComponents = z
	.string()
	.toLowerCase()
	.pipe(
		z.union([
			z.literal("textbox"),
			z.literal("markdown"),
			z.literal("image"),
			z.literal("gallery"),
			z.literal("number"),
			z.literal("audio"),
			z.literal("video"),
			z.literal("file"),
			z.literal("json"),
		])
	);

export type ToolOutputComponents = z.infer<typeof ToolOutputComponents>;

export type ToolLogoColor = z.infer<typeof ToolColor>;
export type ToolLogoIcon = z.infer<typeof ToolIcon>;

export type ToolIOType = "str" | "int" | "float" | "bool" | "file";

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
	mimeTypes: string;
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
	outputComponent: string | null; // Gradio component type to use for the output
	outputComponentIdx: number | null; // index of the output component

	inputs: Array<ToolInput>;
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

	review: ReviewStatus;
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
	| "review"
	| "searchTokens"
	| "type"
	| "createdAt"
	| "updatedAt"
>;

export type Tool = ConfigTool | CommunityTool;

export type ToolFront = Pick<
	Tool,
	"type" | "name" | "displayName" | "description" | "color" | "icon"
> & {
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
	context: BackendToolContext,
	uuid: string
) => AsyncGenerator<MessageUpdate, Omit<ToolResultSuccess, "status" | "call" | "type">, undefined>;
