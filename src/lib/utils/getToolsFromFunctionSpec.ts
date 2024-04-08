import type { Tool } from "$lib/types/Tool";

export async function getToolsFromFunctionSpec(spec: string): Promise<Tool[]> {
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
			name: "directly-answer",
			description:
				"Use this tool to let the user know you wish to answer directly. Do not try to provide any parameters when using this tool.",
			parameter_definitions: {},
			spec,
		},
	];
}
