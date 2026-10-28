import { callMcpTool, type McpServerConfig } from "$lib/server/mcp/httpClient";

/** paged reads of a sandbox or hub file, joined here so no content crosses a model context */

/** the ceiling hf_sandbox_fs cat allows */
export const SANDBOX_PAGE_BYTES = 100_000;
/** hf_fs allows 80,000 but compacts a page whose escaped json outgrows its output budget */
export const HUB_PAGE_BYTES = 32_000;
const ERROR_TEXT_MAX_CHARS = 600;
const IMPORT_OUTCOME = "nothing was imported";

export interface SandboxSource {
	handle: string;
	path: string;
}

export interface ReadLimits {
	maxBytes: number;
	maxPages: number;
	tooLarge: (location: string, size: number) => string;
	/** how a refusal ends, what the caller did not do */
	outcome?: string;
}

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

export const errorText = (text: string): string => {
	const flat = text.trim();
	if (!flat) return "the server gave no reason";
	return flat.length > ERROR_TEXT_MAX_CHARS ? `${flat.slice(0, ERROR_TEXT_MAX_CHARS - 1)}…` : flat;
};

export interface Page {
	content: string;
	truncated: boolean;
	nextOffset?: number;
	/** the whole file, when the server reports it */
	size?: number;
}

export type PageRead = Page | { error: string };

/** the cat envelope both servers return as structured content */
function pageOf(envelope: unknown): Page | undefined {
	const record = asRecord(envelope);
	if (!record || typeof record.content !== "string") return undefined;
	return {
		content: record.content,
		truncated: record.truncated === true,
		...(typeof record.next_offset === "number" ? { nextOffset: record.next_offset } : {}),
		...(typeof record.size === "number" ? { size: record.size } : {}),
	};
}

/** the markdown view of the same page, a fenced block plus a resume line when it was cut */
const FENCED_PAGE =
	/^(`{3,})[^\n]*\n([\s\S]*?)\n\1(?:\n\n_Read \d+ of (\d+) bytes\. Resume with offset (\d+)\._)?\s*$/;

function pageOfText(text: string): Page | undefined {
	const match = FENCED_PAGE.exec(text);
	if (!match) return undefined;
	const [, , content, size, nextOffset] = match;
	return {
		content,
		truncated: nextOffset !== undefined,
		...(nextOffset !== undefined ? { nextOffset: Number(nextOffset) } : {}),
		...(size !== undefined ? { size: Number(size) } : {}),
	};
}

/**
 * the sandbox decodes each page alone so one can end mid character, the clean prefix is
 * exact so its byte length is where the next page starts
 */
function alignedToCharacter(page: Page, offset: number): Page {
	if (!page.truncated) return page;
	const clean = page.content.replace(/�+$/, "");
	if (clean.length === 0 || clean === page.content) return page;
	return { ...page, content: clean, nextOffset: offset + Buffer.byteLength(clean, "utf8") };
}

export async function readSandboxPage(
	server: McpServerConfig,
	source: SandboxSource,
	offset: number,
	signal: AbortSignal | undefined,
	outcome = IMPORT_OUTCOME
): Promise<PageRead> {
	const response = await callMcpTool(
		server,
		"hf_sandbox_fs",
		{
			cmd: "cat",
			args: [
				"cat",
				source.handle,
				source.path,
				"--offset",
				String(offset),
				"--max-bytes",
				String(SANDBOX_PAGE_BYTES),
			],
		},
		{ signal, clientKind: "intern" }
	);
	if (response.isError) return { error: `hf_sandbox_fs cat refused: ${errorText(response.text)}` };
	const page = pageOf(response.structured) ?? pageOfText(response.text);
	if (!page) {
		return {
			error: `hf_sandbox_fs cat of ${source.path} returned neither structured content nor a readable page, so ${outcome}.`,
		};
	}
	return alignedToCharacter(page, offset);
}

export async function readHubPage(
	server: McpServerConfig,
	uri: string,
	offset: number,
	signal: AbortSignal | undefined,
	outcome = IMPORT_OUTCOME
): Promise<PageRead> {
	const response = await callMcpTool(
		server,
		"hf_fs",
		{
			operations: [
				{
					cmd: "cat",
					args: [uri, "--offset", String(offset), "--max-bytes", String(HUB_PAGE_BYTES)],
				},
			],
		},
		{ signal, clientKind: "intern" }
	);
	if (response.isError) return { error: `hf_fs cat refused: ${errorText(response.text)}` };
	// one operation in, one item out, a failed item carries the server reason
	const batch = asRecord(response.structured);
	const item = asRecord(Array.isArray(batch?.results) ? batch.results[0] : undefined);
	if (item) {
		if (item.status === "error") {
			const error = asRecord(item.error);
			const message = typeof error?.message === "string" ? error.message : "no reason given";
			const recovery = typeof error?.recovery === "string" ? ` ${error.recovery}` : "";
			return { error: `hf_fs could not read ${uri}: ${errorText(`${message}${recovery}`)}` };
		}
		if (item.output_truncated === true) {
			return {
				error: `hf_fs cut the page of ${uri} to fit its output budget, so the file could not be read whole and ${outcome}.`,
			};
		}
		const page = pageOf(item.result);
		if (page) return page;
	}
	const page = pageOfText(response.text);
	if (!page) {
		return {
			error: `hf_fs cat of ${uri} returned neither structured content nor a readable page, so ${outcome}.`,
		};
	}
	return page;
}

export async function readWhole(
	readPage: (offset: number) => Promise<PageRead>,
	location: string,
	limits: ReadLimits
): Promise<{ content: string } | { error: string }> {
	const { maxBytes, maxPages, tooLarge, outcome = IMPORT_OUTCOME } = limits;
	const parts: string[] = [];
	let offset = 0;
	let bytes = 0;
	for (let pages = 0; pages < maxPages; pages += 1) {
		const page = await readPage(offset);
		if ("error" in page) return page;
		if (page.size !== undefined && page.size > maxBytes) {
			return { error: tooLarge(location, page.size) };
		}
		bytes += Buffer.byteLength(page.content, "utf8");
		if (bytes > maxBytes) return { error: tooLarge(location, bytes) };
		parts.push(page.content);
		if (!page.truncated) return { content: parts.join("") };
		if (page.nextOffset === undefined || page.nextOffset <= offset) {
			return {
				error: `${location} is paged but the server gave no offset to continue from, so ${outcome}.`,
			};
		}
		offset = page.nextOffset;
	}
	return { error: `${location} did not end within ${maxPages} pages, so ${outcome}.` };
}
