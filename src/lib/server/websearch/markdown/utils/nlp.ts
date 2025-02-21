/** Remove excess whitespace and newlines */
export const sanitizeString = (str: string) =>
	str
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean)
		.join("\n")
		.replaceAll(/ +/g, " ");

/** Collapses a string into a single line */
export const collapseString = (str: string) => sanitizeString(str.replaceAll(/\n/g, " "));
