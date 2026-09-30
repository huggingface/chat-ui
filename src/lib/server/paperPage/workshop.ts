import { randomBytes } from "crypto";
import type { ObjectId } from "mongodb";
import { commit, createBranch, createRepo, downloadFile, listFiles } from "@huggingface/hub";
import type { CommitOperation } from "@huggingface/hub";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import type { PaperPageWorkshop } from "$lib/types/PaperPageWorkshop";
import type { MessageFile } from "$lib/types/Message";
import { downloadFile as downloadAttachment } from "$lib/server/files/downloadFile";

/**
 * The workshop: a Docker Space holding a copy of PAPERPAGE_TEMPLATE_SPACE that runs HF's
 * sbx-server behind Caddy next to a Vite dev server (see docs/source/configuration/paperpage.md).
 * chat-ui reaches it at `https://<host>/__sbx/v1/*` with the Space's SBX_TOKEN secret.
 *
 * The Hub token never enters the container. Git in the Space only tracks what changed; every
 * write to the Hub (checkpoint, publish) is a commit made here with `@huggingface/hub`, because
 * the Hub refuses binary files pushed with plain git and the library uploads them through Xet.
 */

const HUB = "https://huggingface.co";
/** the project inside the container, relative paths resolve against it */
const APP_DIR = "/app";
/** checkpoints go here, the Space only builds main so a push to it never restarts the container */
const DEV_BRANCH = "dev";
/** written once the dev branch was restored into a fresh container, /tmp dies with it */
const RESTORED_MARKER = "/tmp/.paperpage-restored";
/** files the workshop needs and the published static Space must not carry */
const WORKSHOP_ONLY = /^(Dockerfile|\.dockerignore|\.hf\/.*|README\.md)$/;
/** frontmatter for the static Space, kept in the project so the agent can edit it */
const STATIC_README = ".hf/README.static.md";
/** the page's favicon, the project's emoji until the user brings a logo */
const FAVICON = "src/lib/assets/favicon.svg";
/** the identity checkpoints are recorded under in the container's own git */
const GIT_IDENTITY = "-c user.name=PaperPage -c user.email=paperpage@users.noreply.huggingface.co";
/** a git mode the checkpoint skips: a symlink could point at anything in the container */
const SYMLINK_MODE = "120000";

export type Workshop = Pick<PaperPageWorkshop, "spaceId" | "host" | "sbxToken">;

// ---- store ----

export async function findWorkshop(conversationId: ObjectId): Promise<PaperPageWorkshop | null> {
	return collections.paperPageWorkshops.findOne({ _id: conversationId });
}

/**
 * Whether the user said anything after their first message: answered a question or wrote again.
 * A workshop is named with the user, so it is never created on the first message alone.
 */
export async function userHasReplied(conversationId: ObjectId): Promise<boolean> {
	const [answered, conversation] = await Promise.all([
		collections.mcpElicitations.findOne(
			{ conversationId, status: "resolved", action: "accept" },
			{ projection: { _id: 1 } }
		),
		collections.conversations.findOne(
			{ _id: conversationId },
			{ projection: { "messages.from": 1 } }
		),
	]);
	return !!answered || (conversation?.messages.filter((m) => m.from === "user").length ?? 0) > 1;
}

async function saveWorkshop(
	conversationId: ObjectId,
	workshop: Workshop,
	extra: Partial<Pick<PaperPageWorkshop, "templated" | "publishedSpaceId">> = {}
): Promise<void> {
	const now = new Date();
	await collections.paperPageWorkshops.updateOne(
		{ _id: conversationId },
		{
			$set: {
				spaceId: workshop.spaceId,
				host: workshop.host,
				sbxToken: workshop.sbxToken,
				...extra,
				updatedAt: now,
			},
			$setOnInsert: { createdAt: now },
		},
		{ upsert: true }
	);
}

// ---- hub ----

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
	});
}

/**
 * fetch that waits out HF's rate limit (429) instead of failing the tool call: honours Retry-After,
 * else backs off 2s, 5s, 10s. Also retries a 408, where the server never read the request, so
 * nothing ran and repeating it cannot run anything twice. Handed to `@huggingface/hub` too.
 */
export async function fetchWithRetry(
	input: string | URL | Request,
	init: RequestInit = {}
): Promise<Response> {
	const delays = [2_000, 5_000, 10_000];
	// a stream or a Request can only be sent once
	const replayable = !(input instanceof Request) && !(init.body instanceof ReadableStream);
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(input, init);
		const retryable = res.status === 429 || res.status === 408;
		if (!retryable || !replayable || attempt >= delays.length || init.signal?.aborted) {
			return res;
		}
		const retryAfter = Number(res.headers.get("retry-after"));
		await res.body?.cancel();
		await sleep(
			retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : delays[attempt],
			init.signal
		);
	}
}

const hubFetch = fetchWithRetry as typeof fetch;

async function hubJson<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
	const res = await fetchWithRetry(`${HUB}${path}`, {
		...init,
		signal: bounded(30_000, init.signal ?? undefined),
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			...init.headers,
		},
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new HubError(res.status, `${init.method ?? "GET"} ${path}: ${res.status} ${body}`);
	}
	// some endpoints (repo moves) answer with plain text
	const text = await res.text();
	try {
		return JSON.parse(text) as T;
	} catch {
		return text as T;
	}
}

export class HubError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

function statusOf(err: unknown): number | undefined {
	if (err instanceof HubError) return err.status;
	return (err as { statusCode?: number } | null | undefined)?.statusCode;
}

/** the error and whatever body the Hub sent with it, which is where it explains itself */
function describe(err: unknown): string {
	const data = (err as { data?: unknown } | null | undefined)?.data;
	return `${err instanceof Error ? err.message : String(err)} ${data ? JSON.stringify(data) : ""}`;
}

export async function hubUsername(token: string): Promise<string> {
	return (await hubJson<{ name: string }>("/api/whoami-v2", token)).name;
}

/** `owner/name` -> `*.hf.space` host, as the Hub derives it for names short enough not to be hashed */
export function spaceHost(spaceId: string): string {
	const subdomain = spaceId
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${subdomain}.hf.space`;
}

/** the host the Hub actually serves the Space at, which it shortens for long names */
async function servedHost(spaceId: string, token: string): Promise<string> {
	const info = await hubJson<{ host?: string }>(`/api/spaces/${spaceId}`, token).catch(() => ({
		host: undefined,
	}));
	return info.host?.replace(/^https?:\/\//, "").replace(/\/$/, "") || spaceHost(spaceId);
}

export async function spaceRuntime(spaceId: string, token: string): Promise<{ stage: string }> {
	return hubJson<{ stage: string }>(`/api/spaces/${spaceId}/runtime`, token);
}

export async function restartSpace(spaceId: string, token: string): Promise<void> {
	await hubJson(`/api/spaces/${spaceId}/restart`, token, { method: "POST" });
}

/** a refusal to create a protected Space because the account's plan does not include it */
function isPlanRefusal(err: unknown): boolean {
	const status = statusOf(err);
	return (
		(status === 400 || status === 402 || status === 403) &&
		/\b(pro|plan|subscription|upgrade|protected)\b/i.test(describe(err))
	);
}

/**
 * Creates `spaceId` as a new Docker Space holding a copy of the template's files, with a fresh
 * SBX_TOKEN secret. A copy rather than a Hub duplicate, so the user's Space starts with one commit
 * of their own instead of carrying the template's history and authors.
 *
 * Protected, so the app is public (framable) while the source stays private; that needs a PRO or
 * Team account, so that one refusal falls back to public rather than failing the mode for everyone
 * else. The record is saved before the template commit, so a failure there can be resumed.
 */
export async function createWorkshop(
	conversationId: ObjectId,
	spaceId: string,
	token: string,
	card: SpaceCard
): Promise<Workshop & { visibility: "protected" | "public" }> {
	const repo = { type: "space" as const, name: spaceId };
	let visibility: "protected" | "public" = "protected";
	try {
		await createRepo({ repo, accessToken: token, sdk: "docker", visibility, fetch: hubFetch });
	} catch (err) {
		if (statusOf(err) === 409) throw new HubError(409, `${spaceId} already exists`);
		if (!isPlanRefusal(err)) throw err;
		visibility = "public";
		await createRepo({ repo, accessToken: token, sdk: "docker", visibility, fetch: hubFetch });
	}
	// recorded as soon as the Space exists, so a failure in the steps below is resumed, not stuck
	const created = { spaceId, host: spaceHost(spaceId), sbxToken: randomBytes(32).toString("hex") };
	await saveWorkshop(conversationId, created, { templated: false });
	const workshop = await finishWorkshop(conversationId, created, token, card);
	return { ...workshop, visibility };
}

/**
 * The steps after the Space exists: its SBX_TOKEN secret (set first, so the build the template
 * commit starts already has it), its served host, the media bucket and the template files. Each is
 * safe to repeat,
 * which is how page_workshop resumes a creation that failed halfway.
 */
export async function finishWorkshop(
	conversationId: ObjectId,
	workshop: Workshop,
	token: string,
	card: SpaceCard
): Promise<Workshop> {
	await hubJson(`/api/spaces/${workshop.spaceId}/secrets`, token, {
		method: "POST",
		body: JSON.stringify({ key: "SBX_TOKEN", value: workshop.sbxToken }),
	});
	const finished = { ...workshop, host: await servedHost(workshop.spaceId, token) };
	await saveWorkshop(conversationId, finished);
	// there from the start, so the user can drop large files (videos, a big PDF) into it
	await ensureMediaBucket(finished, token);
	await commitTemplate(finished, token, card);
	await saveWorkshop(conversationId, finished, { templated: true });
	return finished;
}

/** copies the template into the workshop, with the project's card in both READMEs and its favicon */
async function commitTemplate(workshop: Workshop, token: string, card: SpaceCard): Promise<void> {
	const template = { type: "space" as const, name: config.PAPERPAGE_TEMPLATE_SPACE.trim() };
	const operations: CommitOperation[] = [];
	for await (const entry of listFiles({
		repo: template,
		recursive: true,
		accessToken: token,
		fetch: hubFetch,
	})) {
		if (entry.type !== "file") continue;
		const blob = await downloadFile({
			repo: template,
			path: entry.path,
			accessToken: token,
			fetch: hubFetch,
		});
		if (!blob) continue;
		const content =
			entry.path === "README.md"
				? new Blob([workshopReadme(card)])
				: entry.path === STATIC_README
					? new Blob([staticReadme(card)])
					: entry.path === FAVICON
						? new Blob([emojiFavicon(card.emoji)])
						: blob;
		operations.push({ operation: "addOrUpdate", path: entry.path, content });
	}
	await commit({
		repo: { type: "space", name: workshop.spaceId },
		title: "Start from the PaperPage template",
		operations,
		accessToken: token,
		fetch: hubFetch,
	});
}

/**
 * Renames the workshop, for a project whose name was agreed after its workshop had to exist (to
 * open an attached paper, say). The Hub keeps the Space running under the new id; its host moves.
 */
export async function renameWorkshop(
	conversationId: ObjectId,
	workshop: Workshop,
	spaceId: string,
	token: string
): Promise<Workshop> {
	try {
		await hubJson("/api/repos/move", token, {
			method: "POST",
			body: JSON.stringify({ fromRepo: workshop.spaceId, toRepo: spaceId, type: "space" }),
		});
	} catch (err) {
		// only an earlier move that landed without being recorded counts: the old id is gone and
		// the new one exists. A taken name (someone else's Space) must fail, not be adopted.
		const exists = (id: string) =>
			spaceRuntime(id, token).then(
				() => true,
				(e) => statusOf(e) !== 404
			);
		if (await exists(workshop.spaceId)) throw err;
		if (!(await exists(spaceId))) throw err;
	}
	const renamed = { ...workshop, spaceId, host: await servedHost(spaceId, token) };
	await saveWorkshop(conversationId, renamed);
	return renamed;
}

/** a Space's name and look on the Hub, as the model proposes it; normalised to what the Hub accepts */
export interface SpaceCard {
	title: string;
	emoji: string;
	colorFrom: string;
	colorTo: string;
	shortDescription: string;
}

export const SPACE_COLORS = ["red", "yellow", "green", "blue", "indigo", "purple", "pink", "gray"];

export function spaceCard(input: Partial<SpaceCard>, fallbackTitle: string): SpaceCard {
	const color = (value: string | undefined, fallback: string) =>
		value && SPACE_COLORS.includes(value) ? value : fallback;
	const emoji = [...new Intl.Segmenter().segment(input.emoji?.trim() ?? "")][0]?.segment;
	return {
		title: (input.title?.trim() || fallbackTitle).slice(0, 80),
		emoji: emoji && /\p{Extended_Pictographic}/u.test(emoji) ? emoji : "📄",
		colorFrom: color(input.colorFrom, "indigo"),
		colorTo: color(input.colorTo, "purple"),
		// the Hub refuses longer ones
		shortDescription: (input.shortDescription?.trim() ?? "").slice(0, 60),
	};
}

function frontmatter(card: SpaceCard, title: string, extra: string[]): string {
	// JSON strings are valid YAML double-quoted scalars, so quotes and colons cannot break it
	return [
		"---",
		`title: ${JSON.stringify(title)}`,
		`emoji: ${card.emoji}`,
		`colorFrom: ${card.colorFrom}`,
		`colorTo: ${card.colorTo}`,
		...extra,
		"header: mini",
		...(card.shortDescription
			? [`short_description: ${JSON.stringify(card.shortDescription)}`]
			: []),
		"---",
		"",
	].join("\n");
}

export function emojiFavicon(emoji: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji}</text></svg>\n`;
}

function workshopReadme(card: SpaceCard): string {
	return frontmatter(card, `${card.title} · workshop`.slice(0, 80), [
		"sdk: docker",
		"app_port: 7860",
	]);
}

function staticReadme(card: SpaceCard): string {
	return frontmatter(card, card.title, [
		"sdk: static",
		"app_build_command: npx -y bun install --frozen-lockfile && npx -y bun run build",
		"app_file: build/index.html",
	]);
}

// ---- sbx-server ----

function sbxUrl(workshop: Workshop, path: string): string {
	return `https://${workshop.host}/__sbx${path}`;
}

/** the caller's signal, bounded so a stalled Space cannot hold a tool call forever */
function bounded(ms: number, signal?: AbortSignal): AbortSignal {
	return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

/** a string as one single-quoted shell word, so `$`, backticks and quotes stay literal */
export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** absolute paths inside the container, anything relative is under the project */
export function containerPath(path: string): string {
	const trimmed = path.trim().replace(/^\.\//, "");
	return trimmed.startsWith("/") ? trimmed : `${APP_DIR}/${trimmed}`;
}

/** workshops seen healthy and restored recently, so back-to-back tool calls skip both checks */
const recentlyReady = new Map<string, number>();
const READY_TTL_MS = 60_000;

export function markReady(workshop: Workshop): void {
	recentlyReady.set(workshop.host, Date.now());
}

export function isRecentlyReady(workshop: Workshop): boolean {
	return Date.now() - (recentlyReady.get(workshop.host) ?? 0) < READY_TTL_MS;
}

export function forgetReady(workshop: Workshop): void {
	recentlyReady.delete(workshop.host);
}

/**
 * Runs `fn` after every earlier locked call for the same workshop settled. Tool calls of one round
 * run in parallel, and two restores, checkpoints or publishes would fight over git's index. Plain
 * writes and commands are not locked: a checkpoint simply saves the state it finds.
 */
const workshopLocks = new Map<string, Promise<unknown>>();

function withLock<T>(workshop: Workshop, fn: () => Promise<T>): Promise<T> {
	const run = (workshopLocks.get(workshop.host) ?? Promise.resolve()).catch(() => {}).then(fn);
	workshopLocks.set(workshop.host, run);
	return run;
}

export async function sbxHealthy(workshop: Workshop, signal?: AbortSignal): Promise<boolean> {
	try {
		const res = await fetch(sbxUrl(workshop, "/health"), { signal: bounded(10_000, signal) });
		return res.ok && ((await res.json()) as { status?: string }).status === "ok";
	} catch {
		return false;
	}
}

/**
 * Runs a shell command in the project directory and collects its interleaved output. sbx-server
 * streams NDJSON events (start, stdout, stderr, ping, exit); only the last `maxChars` of output
 * are kept so a noisy install cannot flood the model or the server.
 */
export async function sbxExec(
	workshop: Workshop,
	cmd: string,
	opts: { timeoutSec?: number; signal?: AbortSignal; maxChars?: number } = {}
): Promise<{ exitCode: number | null; timedOut: boolean; output: string }> {
	const maxChars = opts.maxChars ?? 20_000;
	const timeoutSec = opts.timeoutSec ?? 120;
	const res = await fetchWithRetry(sbxUrl(workshop, "/v1/exec"), {
		method: "POST",
		headers: { "X-Sandbox-Token": workshop.sbxToken, "Content-Type": "application/json" },
		body: JSON.stringify({ cmd, cwd: APP_DIR, timeout: timeoutSec }),
		// the server stops the command at its timeout; this bounds a connection that never answers
		signal: bounded((timeoutSec + 60) * 1000, opts.signal),
	});
	if (!res.ok || !res.body) {
		forgetReady(workshop);
		throw new Error(`workshop exec failed: ${res.status} ${await res.text().catch(() => "")}`);
	}
	let output = "";
	let exitCode: number | null = null;
	let timedOut = false;
	let buffered = "";
	const decoder = new TextDecoder();
	const handle = (line: string) => {
		if (!line.trim()) return;
		const event = JSON.parse(line) as {
			event: string;
			data?: string;
			exit_code?: number | null;
			timed_out?: boolean;
		};
		if ((event.event === "stdout" || event.event === "stderr") && event.data) {
			output = (output + event.data).slice(-maxChars);
		} else if (event.event === "exit") {
			exitCode = event.exit_code ?? null;
			timedOut = event.timed_out === true;
		}
	};
	for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
		buffered += decoder.decode(chunk, { stream: true });
		const lines = buffered.split("\n");
		buffered = lines.pop() ?? "";
		lines.forEach(handle);
	}
	handle(buffered);
	return { exitCode, timedOut, output };
}

/** exec that throws on a non-zero exit, for the commands chat-ui itself relies on */
async function sbxRun(workshop: Workshop, cmd: string, timeoutSec = 120): Promise<string> {
	const result = await sbxExec(workshop, cmd, { timeoutSec, maxChars: 2_000_000 });
	if (result.exitCode !== 0) {
		throw new Error(`\`${cmd}\` failed (exit ${result.exitCode}): ${result.output.slice(-2000)}`);
	}
	return result.output;
}

export async function sbxReadFile(
	workshop: Workshop,
	path: string
): Promise<Uint8Array<ArrayBuffer>> {
	const res = await fetchWithRetry(
		sbxUrl(workshop, `/v1/files/read?path=${encodeURIComponent(containerPath(path))}`),
		{ headers: { "X-Sandbox-Token": workshop.sbxToken }, signal: bounded(120_000) }
	);
	if (!res.ok) {
		forgetReady(workshop);
		throw new Error(`cannot read ${path}: ${res.status} ${await res.text()}`);
	}
	return new Uint8Array(await res.arrayBuffer());
}

export async function sbxWriteFile(
	workshop: Workshop,
	path: string,
	content: string | Blob
): Promise<void> {
	const res = await fetchWithRetry(
		sbxUrl(workshop, `/v1/files/write?path=${encodeURIComponent(containerPath(path))}`),
		{
			method: "PUT",
			headers: { "X-Sandbox-Token": workshop.sbxToken },
			body: content,
			signal: bounded(120_000),
		}
	);
	if (!res.ok) {
		forgetReady(workshop);
		throw new Error(`cannot write ${path}: ${res.status} ${await res.text()}`);
	}
}

// ---- sync with the Hub ----

/** `git ls-files`-style NUL separated paths */
function splitZ(text: string): string[] {
	return text.split("\0").filter(Boolean);
}

/**
 * Parses `git diff --cached --raw --no-renames -z`: each change is a header
 * (`:<src mode> <dst mode> <src sha> <dst sha> <status>`) then its path. Symlinks are skipped:
 * reading one back would read whatever it points at, anywhere in the container.
 */
export function parseStagedChanges(raw: string): {
	upserts: string[];
	deletes: string[];
	skipped: string[];
} {
	const fields = splitZ(raw);
	const changes = { upserts: [] as string[], deletes: [] as string[], skipped: [] as string[] };
	for (let i = 0; i + 1 < fields.length; i += 2) {
		const [, dstMode, , , status] = fields[i].split(" ");
		const path = fields[i + 1];
		if (status === "D") changes.deletes.push(path);
		else if (dstMode === SYMLINK_MODE) changes.skipped.push(path);
		else changes.upserts.push(path);
	}
	return changes;
}

/** runs `fn` over `items` with at most `limit` in flight */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
	const results: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await fn(items[index]);
			}
		})
	);
	return results;
}

/**
 * Reads a project file for a commit to the Hub. Only paths inside the project, and never a file
 * holding the workshop's own secret: the token is readable inside the container (sbx-server's
 * environment), and a commit would publish it.
 */
async function readForHub(workshop: Workshop, path: string): Promise<Blob> {
	if (path.startsWith("/") || path.split("/").includes("..")) {
		throw new Error(`${path} is outside the project; use a path relative to /app.`);
	}
	const bytes = await sbxReadFile(workshop, path);
	if (Buffer.from(bytes).includes(workshop.sbxToken)) {
		throw new Error(`${path} contains the workshop's secret token; remove it before saving.`);
	}
	return new Blob([bytes]);
}

async function readAsOperations(workshop: Workshop, paths: string[]): Promise<CommitOperation[]> {
	return mapLimit(paths, 8, async (path) => ({
		operation: "addOrUpdate" as const,
		path,
		content: await readForHub(workshop, path),
	}));
}

/**
 * Brings a fresh container up to the last checkpoint. The image is built from main, so after a
 * restart or a sleep the working tree is the template again until the dev branch is written
 * back over it; the marker makes every later call a no-op for the life of the container.
 */
export function restoreCheckpoint(workshop: Workshop, token: string): Promise<string> {
	return withLock(workshop, () => restore(workshop, token));
}

async function restore(workshop: Workshop, token: string): Promise<string> {
	const marker = await sbxExec(workshop, `test -f ${RESTORED_MARKER}`);
	if (marker.exitCode === 0) return "already up to date";
	const repo = { type: "space" as const, name: workshop.spaceId };
	const files: string[] = [];
	try {
		for await (const entry of listFiles({
			repo,
			revision: DEV_BRANCH,
			recursive: true,
			accessToken: token,
			fetch: hubFetch,
		})) {
			if (entry.type === "file") files.push(entry.path);
		}
	} catch (err) {
		// no dev branch yet: nothing was checkpointed, the template is the state
		if (statusOf(err) !== 404) throw err;
	}
	let note = "no checkpoint yet, starting from the template";
	if (files.length > 0) {
		await mapLimit(files, 8, async (path) => {
			const blob = await downloadFile({
				repo,
				path,
				revision: DEV_BRANCH,
				accessToken: token,
				fetch: hubFetch,
			});
			if (!blob) throw new Error(`checkpointed file ${path} could not be downloaded`);
			await sbxWriteFile(workshop, path, blob);
		});
		const keep = new Set(files);
		const stale = splitZ(await sbxRun(workshop, "git ls-files -z")).filter((p) => !keep.has(p));
		if (stale.length > 0) {
			// through a file, so neither quoting nor the argument limit can bite
			await sbxWriteFile(workshop, "/tmp/paperpage-stale", stale.join("\0"));
			await sbxRun(workshop, "xargs -0 rm -f -- < /tmp/paperpage-stale");
		}
		await sbxRun(
			workshop,
			`out=$(bun install 2>&1) || { echo "$out" | tail -20; exit 1; }; echo "$out" | tail -3`,
			300
		);
		note = `restored ${files.length} files from the last checkpoint`;
	}
	await sbxRun(
		workshop,
		`git checkout -q -B ${DEV_BRANCH} && git add -A && ` +
			`(git diff --cached --quiet || git ${GIT_IDENTITY} commit -qm "restore checkpoint") && ` +
			`touch ${RESTORED_MARKER}`
	);
	return note;
}

/**
 * Commits everything that changed since the last checkpoint to the dev branch. The container's
 * git decides what changed (so .gitignore applies), the files are read back through sbx-server,
 * and a local commit afterwards makes the next checkpoint incremental. A container that restarted
 * since it was last restored is restored first, so the diff is never taken against the template.
 */
export function checkpoint(
	workshop: Workshop,
	token: string,
	message: string
): Promise<{ changed: number; skipped: string[]; commitUrl?: string }> {
	return withLock(workshop, async () => {
		await restore(workshop, token);
		const { upserts, deletes, skipped } = parseStagedChanges(
			await sbxRun(workshop, "git add -A && git diff --cached --raw --no-renames -z HEAD")
		);
		if (upserts.length + deletes.length === 0) return { changed: 0, skipped };
		const repo = { type: "space" as const, name: workshop.spaceId };
		await createBranch({ repo, branch: DEV_BRANCH, accessToken: token, fetch: hubFetch }).catch(
			(err) => {
				if (statusOf(err) !== 409) throw err;
			}
		);
		const operations: CommitOperation[] = [
			...(await readAsOperations(workshop, upserts)),
			...deletes.map((path) => ({ operation: "delete" as const, path })),
		];
		const result = await commit({
			repo,
			branch: DEV_BRANCH,
			title: message,
			operations,
			accessToken: token,
			fetch: hubFetch,
		});
		await sbxRun(workshop, `git ${GIT_IDENTITY} commit -qm ${shellQuote(message)}`);
		return { changed: operations.length, skipped, commitUrl: result?.commit.url };
	});
}

/**
 * Where a page may be published: a Space of the workshop's owner, never the workshop itself, and
 * either the one this project already published to or a new one. An existing Space it did not
 * create is refused, because publishing replaces every file in the target.
 */
export function publishTargetError(
	target: string,
	workshop: Workshop,
	publishedSpaceId?: string
): string | undefined {
	const owner = workshop.spaceId.split("/")[0];
	const [targetOwner, name, ...rest] = target.split("/");
	if (rest.length > 0 || !name || !/^[\w.-]+$/.test(name)) {
		return `"${target}" is not a Space id (owner/name).`;
	}
	if (targetOwner !== owner) return `Publish under ${owner}/, the workshop's owner.`;
	if (target === workshop.spaceId) return "The target cannot be the workshop itself.";
	if (publishedSpaceId && target !== publishedSpaceId) {
		return `This project publishes to ${publishedSpaceId}; it cannot be moved from here.`;
	}
	return undefined;
}

/**
 * Publishes the checkpointed project as the source of a static Space: everything tracked except
 * the workshop's own files, with `.hf/README.static.md` as its README. The Space builds it itself
 * (`app_build_command`), so what lands on the Hub is source, never a build. The first publish
 * creates the Space and fails if the name is taken; later ones replace its files.
 */
export function publish(
	conversationId: ObjectId,
	workshop: Workshop,
	token: string,
	requested: string | undefined,
	message: string
): Promise<{ target: string; commitUrl?: string }> {
	return withLock(workshop, async () => {
		// read here, inside the lock, so two publishes in one round agree on the target
		const publishedSpaceId = (await findWorkshop(conversationId))?.publishedSpaceId;
		const target = publishedSpaceId || requested || workshop.spaceId.replace(/-dev$/, "");
		const invalid = publishTargetError(target, workshop, publishedSpaceId);
		if (invalid) throw new Error(invalid);
		const tracked = splitZ(await sbxRun(workshop, "git ls-files -z"));
		if (!tracked.includes(STATIC_README)) {
			throw new Error(`${STATIC_README} is missing; it holds the static Space's frontmatter`);
		}
		const repo = { type: "space" as const, name: target };
		if (target !== publishedSpaceId) {
			await createRepo({ repo, accessToken: token, sdk: "static", fetch: hubFetch }).catch(
				(err) => {
					if (statusOf(err) === 409) {
						throw new Error(
							`${target} already exists and is not this project's: pick another name.`
						);
					}
					throw err;
				}
			);
			await saveWorkshop(conversationId, workshop, { publishedSpaceId: target });
		}
		const files = tracked.filter((path) => !WORKSHOP_ONLY.test(path));
		const operations: CommitOperation[] = await readAsOperations(workshop, files);
		operations.push({
			operation: "addOrUpdate",
			path: "README.md",
			content: await readForHub(workshop, STATIC_README),
		});
		const keep = new Set([...files, "README.md", ".gitattributes"]);
		for await (const entry of listFiles({
			repo,
			recursive: true,
			accessToken: token,
			fetch: hubFetch,
		})) {
			if (entry.type === "file" && !keep.has(entry.path)) {
				operations.push({ operation: "delete", path: entry.path });
			}
		}
		const result = await commit({
			repo,
			title: message,
			operations,
			accessToken: token,
			fetch: hubFetch,
		});
		return { target, commitUrl: result?.commit.url };
	});
}

/** the project's public bucket for large media, `owner/<slug>-media` */
export function mediaBucketId(workshop: Workshop): string {
	return `${workshop.spaceId.replace(/-dev$/, "")}-media`;
}

async function ensureMediaBucket(workshop: Workshop, token: string): Promise<void> {
	const repo = { type: "bucket" as const, name: mediaBucketId(workshop) };
	await createRepo({ repo, accessToken: token, visibility: "public", fetch: hubFetch }).catch(
		(err) => {
			if (statusOf(err) !== 409) throw err;
		}
	);
}

/**
 * Uploads workshop files to the project's media bucket and returns their public URLs. Buckets are
 * not git: large videos and 3D assets live there instead of in the Space repos, and the page links
 * them straight from the Hub's CDN (range requests work, so video seeking does).
 */
export async function uploadMedia(
	workshop: Workshop,
	token: string,
	paths: string[]
): Promise<Array<{ path: string; url: string }>> {
	const bucketId = mediaBucketId(workshop);
	await ensureMediaBucket(workshop, token);
	// stored under the file's name, the project layout is the workshop's business
	const named = paths.map((path) => ({ path, name: path.split("/").pop() ?? path }));
	const operations = await mapLimit(named, 4, async ({ path, name }) => ({
		operation: "addOrUpdate" as const,
		path: name,
		content: await readForHub(workshop, path),
	}));
	await commit({
		repo: { type: "bucket", name: bucketId },
		title: "Upload media",
		operations,
		accessToken: token,
		fetch: hubFetch,
	});
	return named.map(({ path, name }) => ({
		path,
		url: `${HUB}/buckets/${bucketId}/resolve/${encodeURIComponent(name)}`,
	}));
}

/** a file in a Hub repo or bucket, as `hf://` URI or `huggingface.co/.../resolve/...` URL */
export interface HubFileRef {
	repo: { type: "model" | "dataset" | "space" | "bucket"; name: string };
	path: string;
	revision?: string;
}

const HUB_TYPES = {
	models: "model",
	datasets: "dataset",
	spaces: "space",
	buckets: "bucket",
} as const;

export function parseHubFileRef(ref: string): HubFileRef | undefined {
	const trimmed = ref.trim();
	const uri = /^hf:\/\/(?:(models|datasets|spaces|buckets)\/)?([^/]+\/[^/]+)\/(.+)$/.exec(trimmed);
	if (uri) {
		const type = HUB_TYPES[(uri[1] ?? "models") as keyof typeof HUB_TYPES];
		return { repo: { type, name: uri[2] }, path: uri[3] };
	}
	const url =
		/^https:\/\/huggingface\.co\/(?:(datasets|spaces|buckets)\/)?([^/]+\/[^/]+)\/(?:resolve|blob)\/(.+)$/.exec(
			trimmed
		);
	if (!url) return undefined;
	const type = HUB_TYPES[(url[1] ?? "models") as keyof typeof HUB_TYPES];
	const rest = url[3].split("/").map(decodeURIComponent);
	// repos resolve through a revision, buckets have none
	return type === "bucket"
		? { repo: { type, name: url[2] }, path: rest.join("/") }
		: { repo: { type, name: url[2] }, revision: rest[0], path: rest.slice(1).join("/") };
}

/**
 * Copies files from the Hub into `/app/.paper/uploads/`, downloaded here with the user's token so
 * private buckets and repos work too. This is how files too large for a chat attachment arrive:
 * the user puts them in a bucket (the project's media bucket, typically) and gives their link.
 */
export async function importFromHub(
	workshop: Workshop,
	token: string,
	refs: string[],
	taken: Set<string>
): Promise<Array<{ path: string; bytes: number }>> {
	const imported: Array<{ path: string; bytes: number }> = [];
	for (const ref of refs) {
		const file = parseHubFileRef(ref);
		if (!file)
			throw new Error(`${ref} is not a Hub file link (hf://… or huggingface.co/…/resolve/…).`);
		const blob = await downloadFile({
			repo: file.repo,
			path: file.path,
			...(file.revision ? { revision: file.revision } : {}),
			accessToken: token,
			fetch: hubFetch,
		});
		if (!blob) throw new Error(`${ref} was not found.`);
		const path = `.paper/uploads/${attachmentFileName(file.path, taken)}`;
		await sbxWriteFile(workshop, path, blob);
		imported.push({ path, bytes: blob.size });
	}
	return imported;
}

/** a safe, unique file name for an attachment: no path, no dot-only names, a suffix on clashes */
export function attachmentFileName(name: string, taken: Set<string>): string {
	const base = (name.split("/").pop() ?? "").replace(/[^\w.-]+/g, "_").replace(/^\.+$/, "");
	const safe = base || "file";
	const dot = safe.lastIndexOf(".");
	const [stem, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""];
	let candidate = safe;
	for (let n = 2; taken.has(candidate); n++) candidate = `${stem}-${n}${ext}`;
	taken.add(candidate);
	return candidate;
}

/**
 * Copies every file the user attached in the conversation into `/app/.paper/uploads/` (a PDF, a
 * zip of the code, a video). The model never sees these files' content, only that they exist; the
 * workshop is where they are opened, unpacked and converted.
 */
export async function importAttachments(
	conversationId: ObjectId,
	workshop: Workshop,
	taken: Set<string>
): Promise<Array<{ path: string; mime: string; bytes: number }>> {
	const conversation = await collections.conversations.findOne(
		{ _id: conversationId },
		{ projection: { "messages.from": 1, "messages.files": 1 } }
	);
	const files = new Map<string, MessageFile>();
	for (const message of conversation?.messages ?? []) {
		if (message.from !== "user") continue;
		for (const file of message.files ?? []) files.set(`${file.type}:${file.value}`, file);
	}
	const imported: Array<{ path: string; mime: string; bytes: number }> = [];
	for (const file of files.values()) {
		const base64 =
			file.type === "hash"
				? (await downloadAttachment(file.value, conversationId)).value
				: file.value;
		const bytes = Buffer.from(base64, "base64");
		const path = `.paper/uploads/${attachmentFileName(file.name, taken)}`;
		await sbxWriteFile(workshop, path, new Blob([bytes]));
		imported.push({ path, mime: file.mime, bytes: bytes.length });
	}
	return imported;
}
