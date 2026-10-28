/**
 * Runs on serialized JSON, where an escaped newline puts the letter `n` right before a token, so
 * a plain word boundary misses it and no boundary at all eats ids like `task-<uuid>`.
 */
const SECRETS =
	/(?<=^|[^A-Za-z0-9]|\\[nrt])(?:hf_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})/g;

export function redact(json: string): string {
	return json.replace(SECRETS, "[REDACTED]");
}
