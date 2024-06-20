import type { Tool } from "$lib/types/Tool";

/**
 * Checks if a tool's name equals a value. Replaces all hyphens with underscores before comparison
 * since some models return underscores even when hyphens are used in the request.
 **/
export function toolHasName(name: string, tool: Pick<Tool, "name">): boolean {
	return tool.name.replaceAll("-", "_") === name.replaceAll("-", "_");
}

export const colors = ["purple", "blue", "green", "yellow", "red"] as const;

export const icons = [
	"wikis",
	"tools",
	"camera",
	"code",
	"email",
	"cloud",
	"terminal",
	"game",
	"chat",
	"speaker",
	"video",
] as const;
