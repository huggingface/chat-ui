import LinkifyIt from "linkify-it";

const TRACKING_PARAMS = new Set([
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_term",
	"utm_content",
	"utm_id",
	"utm_name",
	"utm_reader",
	"utm_place",
	"utm_device",
	"utm_channel",
	"utm_userid",
	"fbclid",
	"gclid",
	"mc_eid",
	"mc_cid",
]);

const linkifier = LinkifyIt().tlds(true);

export interface UrlMatch {
	index: number;
	lastIndex: number;
	raw: string;
	url: string;
}

export const extractUrlMatches = (text: string): UrlMatch[] => {
	if (typeof text !== "string" || text.length === 0) return [];
	const matches = linkifier.match(text);
	if (!matches || matches.length === 0) return [];
	return matches.map((match) => ({
		index: match.index,
		lastIndex: match.lastIndex,
		raw: match.raw,
		url: match.url,
	}));
};

export const canonicalizeUrl = (raw: string): string | null => {
	if (typeof raw !== "string" || raw.length === 0) return null;
	try {
		const url = new URL(raw);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}

		url.hash = "";
		url.hostname = url.hostname.toLowerCase();

		if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
			url.port = "";
		}

		for (const param of Array.from(url.searchParams.keys())) {
			if (TRACKING_PARAMS.has(param)) {
				url.searchParams.delete(param);
			}
		}

		if (url.pathname !== "/") {
			url.pathname = url.pathname.replace(/\/+$/g, "");
			if (url.pathname.length === 0) {
				url.pathname = "/";
			}
		}

		return url.toString();
	} catch {
		return null;
	}
};
