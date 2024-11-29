import type { ConfigTool } from "$lib/types/Tool";
import { ObjectId } from "mongodb";
import { fetchWeatherData, fetchCoordinates } from "./utils";

const weather: ConfigTool = {
	_id: new ObjectId("00000000000000000000000D"),
	type: "config",
	description: "Fetch the weather for a specified location",
	color: "blue",
	icon: "cloud",
	displayName: "Weather",
	name: "weather",
	endpoint: null,
	inputs: [
		{
			name: "location",
			type: "str",
			description: "The name of the location to fetch the weather for",
			paramType: "required",
		},
	],
	outputComponent: null,
	outputComponentIdx: null,
	showOutput: false,
	async *call({ location }) {
		try {
			if (typeof location !== "string") {
				throw new Error("Location must be a string");
			}
			const coordinates = await fetchCoordinates(location);
			const weatherData = await fetchWeatherData(coordinates.latitude, coordinates.longitude);

			return {
				outputs: [{ weather: weatherData }],
			};
		} catch (error) {
			throw new Error("Failed to fetch weather data", { cause: error });
		}
	},
};

export default weather;
