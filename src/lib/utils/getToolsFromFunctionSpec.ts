import type { Tool } from "$lib/types/Tool";

export async function getToolsFromFunctionSpec(spec?: string): Promise<Tool[]> {
	if (!spec) return [];

	return [
		{
			name: "get_weather",
			description:
				"Get the weather forecast for a given location. The location can be a city, country, or even a zip code.",
			parameter_definitions: {
				location: {
					description: "The location to get the weather for.",
					type: "str",
					required: true,
				},
			},
			spec,
		},
		{
			name: "calculator",
			description:
				"A simple calculator, takes a string containing a mathematical expression and returns the answer. Only supports +, -, *, and /, as well as parenthesis ().",
			parameter_definitions: {
				expression: {
					description:
						"The expression to evaluate. Do not include function names or anything else other than digits, +, -, *, /, and ().",
					type: "str",
					required: true,
				},
			},
		},
	];
}
