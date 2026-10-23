import { error, type RequestHandler } from "@sveltejs/kit";
import { ownedReview } from "$lib/server/mlReviews/api";
import { logger } from "$lib/server/logger";
import { reviewMedia } from "$lib/server/mlReviews/media";
import { keepMediaLinks } from "$lib/server/mlReviews/store";

/** the bytes come from a dataset row, nothing in them may run or be sniffed into something that does */
const SAFE_HEADERS = {
	"X-Content-Type-Options": "nosniff",
	"Content-Security-Policy": "default-src 'none'; sandbox",
	"Content-Disposition": "inline",
};

function byteRange(header: string | null, size: number): [number, number] | undefined {
	const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
	if (!match || (!match[1] && !match[2])) return undefined;
	const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
	const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
	return start <= end && start < size ? [start, end] : undefined;
}

export const GET: RequestHandler = async ({ locals, params, request }) => {
	const review = await ownedReview(locals, params.id ?? "", params.reviewId ?? "");
	const index = Number(params.index);
	const outcome = await reviewMedia(review, index, params.field ?? "", { token: locals.token });
	if ("status" in outcome) error(outcome.status, outcome.message);
	if ("redirect" in outcome) {
		if (outcome.links) {
			await keepMediaLinks(review._id, outcome.links).catch((err) =>
				logger.warn({ err, reviewId: review._id.toString() }, "[review] could not keep media links")
			);
		}
		// the viewer signs its links for about an hour, so this answer must not be kept longer
		return new Response(null, {
			status: 302,
			headers: { Location: outcome.redirect, "Cache-Control": "private, max-age=600" },
		});
	}
	const { bytes, contentType } = outcome;
	const headers = {
		...SAFE_HEADERS,
		"Content-Type": contentType,
		"Cache-Control": "private, max-age=3600",
		"Accept-Ranges": "bytes",
	};
	const range = byteRange(request.headers.get("range"), bytes.byteLength);
	if (range) {
		const [start, end] = range;
		return new Response(bytes.slice(start, end + 1), {
			status: 206,
			headers: {
				...headers,
				"Content-Range": `bytes ${start}-${end}/${bytes.byteLength}`,
				"Content-Length": String(end - start + 1),
			},
		});
	}
	return new Response(new Uint8Array(bytes), {
		headers: { ...headers, "Content-Length": String(bytes.byteLength) },
	});
};
