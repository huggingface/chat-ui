export interface SlashCommand {
	name: string;
	description: string;
}

export const BTW_COMMAND: SlashCommand = {
	name: "btw",
	description: "Ask without interrupting the run",
};

/** the partial name while the caret is still in a slash word at index 0, undefined otherwise */
export function slashCommandQuery(value: string, caret: number): string | undefined {
	return /^\/([a-z]*)$/i.exec(value.slice(0, caret))?.[1];
}

export function matchingSlashCommands(query: string, commands: SlashCommand[]): SlashCommand[] {
	const prefix = query.toLowerCase();
	return commands.filter((command) => command.name.startsWith(prefix));
}

/** a known command at index 0 followed by whitespace or the end, for highlighting */
export function leadingSlashCommand(
	value: string,
	commands: SlashCommand[]
): { start: 0; end: number; name: string } | undefined {
	const match = /^\/([a-z]+)(?=\s|$)/i.exec(value);
	if (!match) return undefined;
	const name = match[1].toLowerCase();
	if (!commands.some((command) => command.name === name)) return undefined;
	return { start: 0, end: match[0].length, name };
}
