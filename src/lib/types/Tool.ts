interface ToolInput {
	description: string;
	type: string;
	required?: boolean;
}

export interface Tool {
	name: string;
	displayName?: string;
	description: string;
	parameter_definitions: Record<string, ToolInput>;
	spec?: string;
	isOnByDefault?: true; // will it be toggled if the user hasn't tweaked it in settings ?
	isLocked?: true; // can the user enable/disable it ?
	isHidden?: true; // should it be hidden from the user ?
}

export interface ToolResult {
	key: string;
	status: "success" | "error";
	value: string;
	display?: boolean;
}

export interface Call {
	tool_name: string;
	parameters: Record<string, string>;
}
