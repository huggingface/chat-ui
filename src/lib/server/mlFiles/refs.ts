/**
 * a value is a reference only when the whole trimmed string is one, the same text inside
 * a longer string is content
 */

export const VIRTUAL_FILE_SCHEME = "v-file://";

const REF_PATTERN = /^v-file:\/\/([^@\s]+)(?:@v(\d+))?$/;

export interface VirtualFileRef {
	/** as the model wrote it, trimmed */
	ref: string;
	name: string;
	/** absent means the latest version */
	version?: number;
}

export function parseVirtualFileRef(value: unknown): VirtualFileRef | undefined {
	if (typeof value !== "string") return undefined;
	const ref = value.trim();
	const match = REF_PATTERN.exec(ref);
	if (!match) return undefined;
	return {
		ref,
		name: match[1],
		...(match[2] !== undefined ? { version: Number(match[2]) } : {}),
	};
}

export function formatVirtualFileRef(name: string, version?: number): string {
	return `${VIRTUAL_FILE_SCHEME}${name}${version === undefined ? "" : `@v${version}`}`;
}
