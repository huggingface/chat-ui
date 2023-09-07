export function trimSuffix(input: string, end: string): string {
	if (input.endsWith(end)) {
		return input.slice(0, input.length - end.length);
	}
	return input;
}
