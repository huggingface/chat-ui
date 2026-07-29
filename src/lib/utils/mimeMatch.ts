/**
 * Match a concrete MIME type against an allowlist that may contain wildcards
 * ("image/*" for any subtype, or a wildcard type). Shared by every entry point
 * that accepts user files (paste, drop, programmatic attachments) so they all
 * agree on what is allowed.
 */
export function mimeMatchesAllowlist(mime: string, allowlist: readonly string[]): boolean {
	const [type, subtype] = mime.split("/");
	return allowlist.some((allowed) => {
		const [allowedType, allowedSubtype] = allowed.split("/");
		return (
			(allowedType === "*" || allowedType === type) &&
			(allowedSubtype === "*" || allowedSubtype === subtype)
		);
	});
}
