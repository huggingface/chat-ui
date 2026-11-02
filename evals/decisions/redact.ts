/**
 * Runs on serialized JSON, where an escaped newline puts the letter `n` right before a token, so
 * a plain word boundary misses it and no boundary at all eats ids like `task-<uuid>`.
 */
const SECRETS =
	/(?<=^|[^A-Za-z0-9]|\\[nrt])(?:hf_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|KGAT_[0-9a-f]{20,}|wandb_v1_[A-Za-z0-9_]{20,})/g;

/** distinctive enough to need no boundary: sandbox output prints them glued to text (`token=SEThf_oauth_…`) */
const UNBOUNDED = /hf_oauth_[\w-]+(?:\.[\w-]+){0,2}|eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g;

/** the password in `https://user:<secret>@host`, as `git remote -v` prints it */
const URL_PASSWORD = /(?<=:\/\/[^\s/:@"\\]+:)[^\s/@"\\]{8,}(?=@)/g;

/**
 * A literal assigned to a key-like name (`api_key="…"`, `{"ROBOFLOW_API_KEY": "…"}`); needing a
 * digit keeps placeholders like YOUR_API_KEY. The value is then removed everywhere, since the model
 * repeats it in its reasoning without the name.
 */
const ASSIGNED_KEY =
	/(?<=(?:api_?key|token|secret|password)\\*["']?\s*[=:]\s*\\*["'])(?=[\w-]*\d)[\w-]{16,}(?=\\*["'])/gi;

export function redact(json: string): string {
	const assigned = new Set(json.match(ASSIGNED_KEY));
	let out = json
		.replace(UNBOUNDED, "[REDACTED]")
		.replace(SECRETS, "[REDACTED]")
		.replace(URL_PASSWORD, "[REDACTED]");
	for (const value of assigned) out = out.replaceAll(value, "[REDACTED]");
	return out;
}
