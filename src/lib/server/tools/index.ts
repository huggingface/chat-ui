import { fetchTool } from "./fetch";
import type { NativeTool } from "./types";

const ALL_NATIVE_TOOLS: NativeTool[] = [fetchTool];

export function getEnabledNativeTools(opts: { enableNativeFetch?: boolean }): NativeTool[] {
	return ALL_NATIVE_TOOLS.filter((t) => {
		if (t === fetchTool && opts.enableNativeFetch === false) return false;
		return true;
	});
}

export function findNativeTool(name: string): NativeTool | undefined {
	return ALL_NATIVE_TOOLS.find((t) => t.definition.function.name === name);
}
