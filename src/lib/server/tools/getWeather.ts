import type { BackendTool } from ".";

const getWeather: BackendTool = {
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
	call: async (params) => {
		if (params.location === "New York") {
			return {
				key: "get_weather",
				status: "success",
				value: "It's sunny. 26C. 10% chance of rain.",
			};
		} else if (params.location === "London") {
			return {
				key: "get_weather",
				status: "success",
				value: "It's cloudy. 18C. 50% chance of rain.",
			};
		} else {
			return {
				key: "get_weather",
				status: "error",
				value: "Location not found",
			};
		}
	},
};

export default getWeather;
