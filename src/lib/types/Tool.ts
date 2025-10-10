export enum ToolResultStatus {
	Success = "success",
	Error = "error",
}

export interface ToolCall {
	name: string;
	parameters: Record<string, string | number | boolean>;
	toolId?: string;
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

export interface ToolFront {
	_id: string;
	name: string;
	displayName?: string;
	description?: string;
	color?: string;
	icon?: string;
	type?: "config" | "community";
	isOnByDefault?: boolean;
	isLocked?: boolean;
	mimeTypes?: string[];
	timeToUseMS?: number;
}
