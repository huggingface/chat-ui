interface ToolInput {
	description: string;
	type: string;
	required?: boolean;
}

export interface Tool {
	name: string;
	description: string;
	parameter_definitions: Record<string, ToolInput>;
	spec?: string;
}

export interface ToolResult {
	key: string;
	status: "success" | "error";
	value: string;
}

export interface Call {
	tool_name: string;
	parameters: Record<string, string>;
}
