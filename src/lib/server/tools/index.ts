import type { Tool, ToolResult } from "$lib/types/Tool";
import calculator from "./calculator";
import directlyAnswer from "./directlyAnswer";
import getWeather from "./getWeather";
import websearch from "./websearch";

export interface BackendTool extends Tool {
	call?(params: Record<string, string>): Promise<ToolResult>;
}

export const tools: BackendTool[] = [calculator, getWeather, websearch, directlyAnswer];
