import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import type { OpenAiTool } from "$lib/server/mcp/tools";
import {
	HubError,
	SPACE_COLORS,
	checkpoint,
	containerPath,
	createWorkshop,
	findWorkshop,
	finishWorkshop,
	forgetReady,
	hubUsername,
	importAttachments,
	importFromHub,
	mediaBucketId,
	isRecentlyReady,
	markReady,
	publish,
	renameWorkshop,
	restartSpace,
	restoreCheckpoint,
	sbxExec,
	sbxHealthy,
	sbxReadFile,
	sbxWriteFile,
	spaceCard,
	spaceRuntime,
	uploadMedia,
	userHasReplied,
	type Workshop,
} from "$lib/server/paperPage/workshop";
import { PAGE_TOOLS } from "$lib/constants/paperPage";
import { previewLine } from "$lib/utils/spacePreview";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";

/**
 * The PaperPage workshop tools. Every one resolves the conversation's workshop from the store, so
 * the Hub token and the Space's sbx token never pass through a tool call; the preview URL printed
 * on a `Preview:` line (see `$lib/utils/spacePreview`) is what the side pane frames.
 */

/** how long page_workshop waits for a building or waking Space before handing back */
const READY_TIMEOUT_MS = 8 * 60_000;
const READY_POLL_MS = 10_000;
/** what a tool result shows of a file or a command's output */
const MAX_RESULT_CHARS = 40_000;
/** short enough that `<user>-<slug>-dev` stays a plain subdomain */
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** an arXiv id or other number is a poor name for a Space the user keeps */
const ID_LIKE = /arxiv|\d{4}/;
/**
 * Image views allowed per turn: each one costs the model a large input and stays in the
 * conversation document, and the prompt's "use it sparingly" is not always enough on its own.
 */
const MAX_IMAGE_VIEWS_PER_TURN = 12;
const imageViews = new Map<string, number>();

/** images stay in the conversation document, so past this a call shows no more of them */
const MAX_IMAGES_BASE64 = 1_500_000;

/**
 * Whether the page still renders after a write: the dev server compiles on request, so a 500
 * here is the error the user would see in the preview. Only the root route; files outside the
 * project (raw paper material, media) are not checked. A page that imports Tailwind but serves
 * none of its CSS has lost the stylesheet import, the usual casualty of a layout rewrite.
 */
export const PREVIEW_CHECK = [
	`code=$(curl -s -o /tmp/preview.html -w '%{http_code}' --max-time 60 http://127.0.0.1:5173/)`,
	`if [ "$code" = 200 ]; then`,
	`  echo "Preview renders (HTTP 200)."`,
	`  if grep -q tailwindcss src/routes/layout.css 2>/dev/null && ! grep -q 'tailwindcss v4' /tmp/preview.html; then`,
	`    echo "WARNING: no Tailwind CSS on the page: src/routes/+layout.svelte must keep import './layout.css'."`,
	`  fi`,
	`else`,
	`  echo "PREVIEW BROKEN (HTTP $code). Fix this before anything else:"`,
	`  echo "--- dev log ---"; tail -n 20 /tmp/dev.log`,
	`  echo "--- page ---"; sed 's/<[^>]*>/ /g' /tmp/preview.html | tr -s ' \\n' | tail -c 800; echo`,
	`fi`,
].join("\n");

async function previewStatus(workshop: Workshop, path: string): Promise<string> {
	const full = containerPath(path);
	if (!full.startsWith("/app/") || /^\/app\/\.(paper|media)\//.test(full)) return "";
	try {
		const result = await sbxExec(workshop, PREVIEW_CHECK, { timeoutSec: 90, maxChars: 4000 });
		return `\n${result.output.trim()}`;
	} catch {
		return "";
	}
}

interface PaperPageToolParams {
	conversationId: ObjectId;
	/** the user's Hub token, absent for a run without one */
	hubToken: () => string | undefined;
}

type Resolved = { workshop: Workshop; token: string } | { error: string };

const NO_TOKEN =
	"No Hugging Face token for this conversation, so the workshop Space cannot be reached. Tell the user to sign in with Hugging Face.";

/** the conversation's workshop, reachable and restored, before anything reads or writes it */
async function ready(params: PaperPageToolParams): Promise<Resolved> {
	const token = params.hubToken();
	if (!token) return { error: NO_TOKEN };
	try {
		const stored = await findWorkshop(params.conversationId);
		if (!stored) {
			return {
				error: `No workshop yet. Call ${PAGE_TOOLS.workshop} with the project's slug first.`,
			};
		}
		const resolved = { workshop: stored, token };
		// each check is a request to the Space; skipping them between close calls keeps a burst of
		// small edits under HF's rate limit
		if (isRecentlyReady(stored)) return resolved;
		if (!(await sbxHealthy(stored))) {
			forgetReady(stored);
			return {
				error: `The workshop is not reachable (building, restarting or asleep). Call ${PAGE_TOOLS.workshop} to wake it and wait for it.`,
			};
		}
		await restoreCheckpoint(stored, token);
		markReady(stored);
		return resolved;
	} catch (err) {
		const failed = fail(err, "Preparing the workshop");
		return { error: "error" in failed ? failed.error : "Preparing the workshop failed." };
	}
}

function clip(text: string): string {
	return text.length > MAX_RESULT_CHARS
		? `[… ${text.length - MAX_RESULT_CHARS} earlier characters cut]\n${text.slice(-MAX_RESULT_CHARS)}`
		: text;
}

function str(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

function fail(err: unknown, what: string): BuiltinToolResult {
	logger.warn({ err: String(err) }, `[paperpage] ${what} failed`);
	// a Hub refusal explains itself in its body (e.g. an invalid README field), which the model can fix
	const data = (err as { data?: unknown } | null | undefined)?.data;
	const detail = data ? ` ${JSON.stringify(data).slice(0, 1000)}` : "";
	return { error: `${what} failed: ${err instanceof Error ? err.message : String(err)}${detail}` };
}

function fn(name: string, description: string, properties: object, required: string[]): OpenAiTool {
	return {
		type: "function",
		function: { name, description, parameters: { type: "object", properties, required } },
	};
}

async function waitUntilReady(
	workshop: Workshop,
	token: string,
	signal?: AbortSignal
): Promise<string> {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	let woke = false;
	for (;;) {
		if (await sbxHealthy(workshop, signal)) return "RUNNING";
		const { stage } = await spaceRuntime(workshop.spaceId, token);
		if (/ERROR/.test(stage)) return stage;
		if (!woke && (stage === "SLEEPING" || stage === "PAUSED" || stage === "STOPPED")) {
			await restartSpace(workshop.spaceId, token);
			woke = true;
		}
		if (Date.now() > deadline || signal?.aborted) return stage;
		await new Promise((r) => setTimeout(r, READY_POLL_MS));
	}
}

function workshopTool(params: PaperPageToolParams): BuiltinTool {
	return {
		name: PAGE_TOOLS.workshop,
		definition: fn(
			PAGE_TOOLS.workshop,
			"Create this conversation's workshop Space (a live SvelteKit dev server the user sees in the side pane) " +
				"or, when it exists, wake it and bring it back to the last checkpoint. Waits until the dev server is up, " +
				"which takes a few minutes the first time.",
			{
				slug: {
					type: "string",
					description:
						"The project name agreed with the user, kebab-case, e.g. 'unimate'. The workshop becomes " +
						"<user>/<slug>-dev and the published page <user>/<slug>. A different name later renames the workshop.",
				},
				title: {
					type: "string",
					description: "The project's title on the Hub, e.g. 'Mamba'. Used when creating.",
				},
				emoji: { type: "string", description: "One emoji for the Space card. Used when creating." },
				color_from: {
					type: "string",
					enum: SPACE_COLORS,
					description: "Card gradient start. Used when creating.",
				},
				color_to: {
					type: "string",
					enum: SPACE_COLORS,
					description: "Card gradient end. Used when creating.",
				},
				short_description: {
					type: "string",
					description: "One line about the project, at most 60 characters. Used when creating.",
				},
			},
			[]
		),
		async execute(args, ctx: BuiltinToolContext) {
			const token = params.hubToken();
			if (!token) return { error: NO_TOKEN };
			const slug = str(args, "slug").trim().toLowerCase();
			if (slug && (!SLUG.test(slug) || ID_LIKE.test(slug))) {
				return {
					error:
						"Pass the short name agreed with the user as `slug`, kebab-case and at most 40 characters: the " +
						"method or project name (e.g. 'mamba', 'unimate'), never an arXiv id or a number.",
				};
			}
			const card = spaceCard(
				{
					title: str(args, "title"),
					emoji: str(args, "emoji"),
					colorFrom: str(args, "color_from"),
					colorTo: str(args, "color_to"),
					shortDescription: str(args, "short_description"),
				},
				slug
			);
			try {
				const stored = await findWorkshop(params.conversationId);
				let workshop: Workshop;
				let note = "";
				if (!stored) {
					if (!slug) return { error: "Pass the project's `slug` to create the workshop." };
					if (!(await userHasReplied(params.conversationId))) {
						return {
							error:
								"The workshop is named with the user: ask them for the page's name first (ask_user_question, " +
								"your suggested slug, title, emoji and colors as the recommendation), then create it with their answer.",
						};
					}
					const spaceId = `${await hubUsername(token)}/${slug}-dev`;
					const made = await createWorkshop(params.conversationId, spaceId, token, card);
					workshop = made;
					note =
						made.visibility === "protected"
							? "Created the workshop (protected: the page is public, the source private)."
							: "Created the workshop as a PUBLIC Space (protected visibility needs a PRO account), so its source and checkpoints are visible.";
				} else {
					// a creation that failed after the Space existed resumes here
					workshop =
						stored.templated === false
							? await finishWorkshop(params.conversationId, stored, token, card)
							: stored;
					const owner = stored.spaceId.split("/")[0];
					if (slug && stored.spaceId !== `${owner}/${slug}-dev`) {
						workshop = await renameWorkshop(
							params.conversationId,
							workshop,
							`${owner}/${slug}-dev`,
							token
						);
						note = `Renamed the workshop to ${workshop.spaceId}; the preview moved with it.`;
					}
				}
				const stage = await waitUntilReady(workshop, token, ctx.abortSignal);
				const header = [
					note,
					`Workshop: https://huggingface.co/spaces/${workshop.spaceId}`,
					`Media bucket (public; where the user can upload large files, such as videos or a paper over 10 MB): https://huggingface.co/buckets/${mediaBucketId(workshop)}`,
					previewLine(workshop.host),
				]
					.filter(Boolean)
					.join("\n");
				if (stage !== "RUNNING") {
					return {
						resultText: `${header}\nNot ready yet (stage ${stage}). Call ${PAGE_TOOLS.workshop} again in a moment.`,
					};
				}
				const restored = await restoreCheckpoint(workshop, token);
				markReady(workshop);
				return { resultText: `${header}\nDev server running; ${restored}. Project root: /app.` };
			} catch (err) {
				if (err instanceof HubError && err.status === 409) {
					return { error: "That Space name is taken. Call again with another slug." };
				}
				return fail(err, "Preparing the workshop");
			}
		},
	};
}

function execTool(params: PaperPageToolParams): BuiltinTool {
	return {
		name: PAGE_TOOLS.exec,
		definition: fn(
			PAGE_TOOLS.exec,
			"Run a shell command in the workshop, in /app (the SvelteKit project), as a non-root user; also how you " +
				"read files (cat, sed -n, grep). Available: bun, git, curl, file, tar, poppler-utils (pdftotext, pdfimages, " +
				"pdftocairo, pdftoppm), ImageMagick (magick), ffmpeg, unzip and agent-browser (a headless Chrome that stays open between calls). Dev server log: /tmp/dev.log. Returns the " +
				"exit code and the tail of the output.",
			{
				command: { type: "string", description: "Shell command, run with /bin/sh -c." },
				timeout: {
					type: "number",
					description: "Seconds before it is killed. Default 120, max 900.",
				},
			},
			["command"]
		),
		async execute(args, ctx) {
			const command = str(args, "command");
			if (!command.trim()) return { error: "No command given." };
			const resolved = await ready(params);
			if ("error" in resolved) return resolved;
			const timeout = Math.min(Math.max(Number(args.timeout) || 120, 1), 900);
			try {
				const result = await sbxExec(resolved.workshop, command, {
					timeoutSec: timeout,
					signal: ctx.abortSignal,
					maxChars: MAX_RESULT_CHARS,
				});
				const status = result.timedOut ? `timed out after ${timeout}s` : `exit ${result.exitCode}`;
				return { resultText: `[${status}]\n${clip(result.output) || "(no output)"}` };
			} catch (err) {
				return fail(err, "Running the command");
			}
		},
	};
}

function writeFileTool(params: PaperPageToolParams): BuiltinTool {
	return {
		name: PAGE_TOOLS.writeFile,
		definition: fn(
			PAGE_TOOLS.writeFile,
			"Create or overwrite a text file in the workshop (parents are created). The dev server picks it up at once, " +
				"and the result says whether the page still renders. To change part of an existing file use " +
				`${PAGE_TOOLS.editFile}.`,
			{ path: { type: "string" }, content: { type: "string" } },
			["path", "content"]
		),
		async execute(args) {
			const path = str(args, "path").trim();
			if (!path) return { error: "No path given." };
			const resolved = await ready(params);
			if ("error" in resolved) return resolved;
			try {
				await sbxWriteFile(resolved.workshop, path, str(args, "content"));
				return { resultText: `Wrote ${path}.${await previewStatus(resolved.workshop, path)}` };
			} catch (err) {
				return fail(err, "Writing the file");
			}
		},
	};
}

function editFileTool(params: PaperPageToolParams): BuiltinTool {
	return {
		name: PAGE_TOOLS.editFile,
		definition: fn(
			PAGE_TOOLS.editFile,
			"Replace an exact snippet in a workshop file. old_string must match exactly once unless replace_all is " +
				"true. The result says whether the page still renders.",
			{
				path: { type: "string" },
				old_string: { type: "string" },
				new_string: { type: "string" },
				replace_all: { type: "boolean" },
			},
			["path", "old_string", "new_string"]
		),
		async execute(args) {
			const path = str(args, "path").trim();
			const oldString = str(args, "old_string");
			if (!path) return { error: "No path given." };
			if (!oldString) return { error: "old_string is empty." };
			const resolved = await ready(params);
			if ("error" in resolved) return resolved;
			try {
				const text = new TextDecoder().decode(await sbxReadFile(resolved.workshop, path));
				const count = text.split(oldString).length - 1;
				if (count === 0) return { error: `old_string not found in ${path}. Read the file again.` };
				if (count > 1 && args.replace_all !== true) {
					return {
						error: `old_string matches ${count} times in ${path}; add context or set replace_all.`,
					};
				}
				const next =
					args.replace_all === true
						? text.split(oldString).join(str(args, "new_string"))
						: text.replace(oldString, () => str(args, "new_string"));
				await sbxWriteFile(resolved.workshop, path, next);
				const preview = await previewStatus(resolved.workshop, path);
				return {
					resultText: `Edited ${path} (${count} replacement${count > 1 ? "s" : ""}).${preview}`,
				};
			} catch (err) {
				return fail(err, "Editing the file");
			}
		},
	};
}

function checkpointTool(params: PaperPageToolParams): BuiltinTool {
	return {
		name: PAGE_TOOLS.checkpoint,
		definition: fn(
			PAGE_TOOLS.checkpoint,
			"Save every change in the workshop to the Space's dev branch. The container is disposable: anything not " +
				"checkpointed is lost when it sleeps or restarts. Does not restart the dev server.",
			{ message: { type: "string", description: "Commit message, e.g. 'Add results carousel'." } },
			["message"]
		),
		async execute(args) {
			const resolved = await ready(params);
			if ("error" in resolved) return resolved;
			try {
				const message = str(args, "message").trim() || "Checkpoint";
				const done = await checkpoint(resolved.workshop, resolved.token, message);
				const summary = done.changed
					? `Checkpointed ${done.changed} file change(s). ${done.commitUrl ?? ""}`
					: "Nothing changed since the last checkpoint.";
				const skipped = done.skipped.length
					? `\nNot saved (symlinks): ${done.skipped.join(", ")}`
					: "";
				// repeated here so the side pane finds the preview even when page_workshop was not called
				return {
					resultText: `${summary}${skipped}\n${previewLine(resolved.workshop.host)}`,
				};
			} catch (err) {
				return fail(err, "Checkpointing");
			}
		},
	};
}

function publishTool(params: PaperPageToolParams): BuiltinTool {
	return {
		name: PAGE_TOOLS.publish,
		definition: fn(
			PAGE_TOOLS.publish,
			"Checkpoint, then publish the project's source to its static Space, which builds and serves the page " +
				"(frontmatter from .hf/README.static.md). Only when the user asked to publish. Run `bun run build` first " +
				"to catch errors: the static Space runs the same build.",
			{
				space_id: {
					type: "string",
					description:
						"Target Space, `<workshop owner>/<name>`: only for the first publish, when the user chose a name " +
						"other than the workshop id without -dev. Later publishes always go to the same Space.",
				},
				message: { type: "string" },
			},
			[]
		),
		async execute(args) {
			const resolved = await ready(params);
			if ("error" in resolved) return resolved;
			try {
				const message = str(args, "message").trim() || "Publish page";
				await checkpoint(resolved.workshop, resolved.token, message);
				const done = await publish(
					params.conversationId,
					resolved.workshop,
					resolved.token,
					str(args, "space_id").trim() || undefined,
					message
				);
				return {
					resultText: [
						`Published to https://huggingface.co/spaces/${done.target} ${done.commitUrl ?? ""}`,
						"The Space now builds the page (a minute or two); it is served at the Space URL once the build succeeds.",
					].join("\n"),
				};
			} catch (err) {
				return fail(err, "Publishing");
			}
		},
	};
}

function uploadMediaTool(params: PaperPageToolParams): BuiltinTool {
	return {
		name: PAGE_TOOLS.uploadMedia,
		definition: fn(
			PAGE_TOOLS.uploadMedia,
			"Upload large media (videos, audio, 3D assets, big images) from the workshop to the project's public Hugging " +
				"Face bucket and get their public URLs to use in the page. Keep the originals in /app/.media/ (git-ignored), " +
				"compress them first, and give each a distinct file name: files are stored by name.",
			{
				paths: {
					type: "array",
					items: { type: "string" },
					description: "Workshop paths, e.g. ['.media/teaser.mp4'].",
				},
			},
			["paths"]
		),
		async execute(args) {
			const paths = Array.isArray(args.paths)
				? args.paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
				: [];
			if (paths.length === 0) return { error: "No paths given." };
			const resolved = await ready(params);
			if ("error" in resolved) return resolved;
			try {
				const uploaded = await uploadMedia(resolved.workshop, resolved.token, paths);
				return { resultText: uploaded.map(({ path, url }) => `${path} -> ${url}`).join("\n") };
			} catch (err) {
				return fail(err, "Uploading media");
			}
		},
	};
}

function importAttachmentsTool(params: PaperPageToolParams): BuiltinTool {
	return {
		name: PAGE_TOOLS.importAttachments,
		definition: fn(
			PAGE_TOOLS.importAttachments,
			"Copy the user's files into /app/.paper/uploads/ in the workshop, where you can open, unpack and " +
				"convert them: every file attached in this conversation (you see those only as '[attached file, not " +
				"shown to you: ...]'), plus any Hub files given in from_hub. Files over the 10 MB attachment limit " +
				"(videos, a large PDF) come through a bucket: ask the user to upload them to the project's media " +
				"bucket and give you the links.",
			{
				from_hub: {
					type: "array",
					items: { type: "string" },
					description:
						"Hub file links, e.g. ['hf://buckets/alice/mamba-media/paper.pdf', " +
						"'https://huggingface.co/datasets/alice/data/resolve/main/demo.mp4']. Private files work.",
				},
			},
			[]
		),
		async execute(args) {
			const refs = Array.isArray(args.from_hub)
				? args.from_hub.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
				: [];
			const resolved = await ready(params);
			if ("error" in resolved) return resolved;
			try {
				const taken = new Set<string>();
				const attached = await importAttachments(params.conversationId, resolved.workshop, taken);
				const fromHub = await importFromHub(resolved.workshop, resolved.token, refs, taken);
				const lines = [
					...attached.map((f) => `${f.path} (${f.mime}, ${f.bytes} bytes)`),
					...fromHub.map((f) => `${f.path} (${f.bytes} bytes, from the Hub)`),
				];
				return {
					resultText: lines.length
						? lines.join("\n")
						: "No file to import: nothing is attached in this conversation and no Hub link was given.",
				};
			} catch (err) {
				return fail(err, "Importing files");
			}
		},
	};
}

const IMAGE_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
};

function viewImageTool(params: PaperPageToolParams): BuiltinTool {
	return {
		name: PAGE_TOOLS.viewImage,
		definition: fn(
			PAGE_TOOLS.viewImage,
			"Show images from the workshop (PNG, JPEG, WebP or GIF): a screenshot taken with agent-browser, an " +
				"extracted figure, a rendered frame. They are shown to the user, and sent to you when your model reads " +
				"images. Convert an SVG or PDF to PNG first.",
			{
				paths: {
					type: "array",
					items: { type: "string" },
					description: "Workshop paths, e.g. ['/tmp/shot.jpg', 'static/fig/teaser.png'].",
				},
			},
			["paths"]
		),
		async execute(args, ctx) {
			const paths = Array.isArray(args.paths)
				? args.paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
				: [];
			if (paths.length === 0) return { error: "No paths given." };
			const turn = ctx.generationId ?? ctx.messageId ?? "";
			const seen = imageViews.get(turn) ?? 0;
			if (seen >= MAX_IMAGE_VIEWS_PER_TURN) {
				return {
					error: `No more image views this turn (${MAX_IMAGE_VIEWS_PER_TURN} used). Judge from the snapshot, errors and console, or ask the user what they see.`,
				};
			}
			imageViews.set(turn, seen + 1);
			// only the latest turns matter; keep the map from growing with every turn served
			if (imageViews.size > 500) imageViews.delete(imageViews.keys().next().value ?? "");
			const resolved = await ready(params);
			if ("error" in resolved) return resolved;
			try {
				let budget = MAX_IMAGES_BASE64;
				const images: Array<{ data: string; mimeType: string }> = [];
				const notes: string[] = [];
				for (const path of paths.slice(0, 6)) {
					const mimeType = IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
					if (!mimeType) {
						notes.push(`${path}: not a PNG, JPEG, WebP or GIF`);
						continue;
					}
					const data = Buffer.from(await sbxReadFile(resolved.workshop, path)).toString("base64");
					if (data.length > budget) {
						notes.push(`${path}: too large to show; shrink it or take a smaller screenshot`);
						continue;
					}
					budget -= data.length;
					images.push({ data, mimeType });
				}
				return {
					resultText: [`${images.length} image(s) shown to the user.`, ...notes].join("\n"),
					images,
				};
			} catch (err) {
				return fail(err, "Showing the images");
			}
		},
	};
}

export function createPaperPageTools(params: PaperPageToolParams): BuiltinTool[] {
	return [
		workshopTool(params),
		execTool(params),
		writeFileTool(params),
		editFileTool(params),
		checkpointTool(params),
		publishTool(params),
		uploadMediaTool(params),
		importAttachmentsTool(params),
		viewImageTool(params),
	];
}
