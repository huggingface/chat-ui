type ToolInput =
	| {
			description: string;
			type: string;
			required: true;
	  }
	| {
			description: string;
			type: string;
			required: false;
			default: string | number | boolean;
	  };

export interface Tool {
	name: string;
	displayName?: string;
	description: string;
	/** List of mime types that tool accepts */
	mimeTypes?: string[];
	parameterDefinitions: Record<string, ToolInput>;
	spec?: string;
	isOnByDefault?: true; // will it be toggled if the user hasn't tweaked it in settings ?
	isLocked?: true; // can the user enable/disable it ?
	isHidden?: true; // should it be hidden from the user ?
}

export type ToolFront = Pick<
	Tool,
	"name" | "displayName" | "description" | "isOnByDefault" | "isLocked" | "mimeTypes"
> & { timeToUseMS?: number };

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
