export function trimPrefix(input: string, prefix: string) {
	if (input.startsWith(prefix)) {
		return input.slice(prefix.length);
	}
	return input;
}
