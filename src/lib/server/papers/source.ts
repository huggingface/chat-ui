/**
 * What `open_paper` accepts: an arXiv id, an arXiv / Hugging Face papers /
 * alphaXiv page for one, or the https URL of any PDF. arXiv papers are fetched
 * from arxiv.org and keep their arXiv id as the paper id, so citations read
 * naturally (`paper:1706.03762#p3`).
 */

export type PaperSource =
	| { kind: "arxiv"; arxivId: string; version?: string; pdfUrl: string; pageUrl: string }
	| { kind: "url"; pdfUrl: string };

const ARXIV_NEW = /^(\d{4}\.\d{4,5})(v\d+)?$/;
const ARXIV_OLD = /^([a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/;

function arxiv(id: string): PaperSource | null {
	const cleaned = id
		.trim()
		.replace(/^arxiv:/i, "")
		.replace(/\.pdf$/i, "");
	const m = ARXIV_NEW.exec(cleaned) ?? ARXIV_OLD.exec(cleaned);
	if (!m) return null;
	const [, arxivId, version] = m;
	return {
		kind: "arxiv",
		arxivId,
		...(version ? { version } : {}),
		pdfUrl: `https://arxiv.org/pdf/${arxivId}${version ?? ""}`,
		pageUrl: `https://arxiv.org/abs/${arxivId}${version ?? ""}`,
	};
}

/** Pages that name an arXiv paper in their path. */
const ARXIV_PAGE_HOSTS = new Set([
	"arxiv.org",
	"www.arxiv.org",
	"export.arxiv.org",
	"huggingface.co",
	"hf.co",
	"alphaxiv.org",
	"www.alphaxiv.org",
]);

export function resolvePaperSource(input: string): PaperSource | { error: string } {
	const raw = input.trim();
	if (!raw) return { error: "No paper given." };
	const direct = arxiv(raw);
	if (direct) return direct;

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return {
			error:
				`"${raw.slice(0, 100)}" is neither an arXiv id (like 1706.03762) nor a URL. ` +
				"Pass an arXiv id, an arXiv or Hugging Face paper page, or the https URL of a PDF.",
		};
	}
	if (url.protocol !== "https:") return { error: "Only https URLs can be opened." };

	const host = url.hostname.toLowerCase();
	if (ARXIV_PAGE_HOSTS.has(host)) {
		const m = /^\/(?:abs|pdf|papers|html)\/(.+?)\/?$/.exec(url.pathname);
		const found = m ? arxiv(decodeURIComponent(m[1])) : null;
		if (found) return found;
		if (host.endsWith("arxiv.org") || host === "huggingface.co" || host === "hf.co") {
			return { error: `Could not find an arXiv id in ${url.toString()}.` };
		}
	}
	return { kind: "url", pdfUrl: url.toString() };
}
