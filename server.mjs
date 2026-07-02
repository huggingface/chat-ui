// Production server: wraps the adapter-node handler with response compression.
//
// adapter-node serves pre-compressed static assets (sirv finds the .gz/.br
// files emitted at build time) but streams dynamic responses — SSR HTML and
// API JSON — uncompressed. This wrapper gzip/brotli-encodes those.
//
// Streaming endpoints are explicitly excluded: the chat token stream
// (application/jsonl, POST /conversation/[id]) and SSE
// (text/event-stream, /api/v2/conversations/updates) must reach the client
// chunk-by-chunk, and compression would buffer them, silently destroying
// time-to-first-token.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import compression from "compression";

const STREAMING_CONTENT_TYPES = /^(?:text\/event-stream|application\/jsonl)\b/i;

export function shouldCompress(req, res) {
	const contentType = String(res.getHeader("Content-Type") ?? "");
	if (STREAMING_CONTENT_TYPES.test(contentType)) return false;
	return compression.filter(req, res);
}

export function createAppServer(handler) {
	const compress = compression({ filter: shouldCompress });
	return createServer((req, res) => {
		compress(req, res, () =>
			handler(req, res, () => {
				res.statusCode = 404;
				res.end("Not found");
			})
		);
	});
}

const isMain =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
	const { handler } = await import("./build/handler.js");
	const server = createAppServer(handler);
	const port = parseInt(process.env.PORT ?? "3000", 10);
	const host = process.env.HOST ?? "0.0.0.0";
	server.listen(port, host, () => {
		console.log(`Listening on http://${host}:${port}`);
	});

	const shutdown = () => {
		server.close(() => process.exit(0));
		const timeout = parseInt(process.env.SHUTDOWN_TIMEOUT ?? "30", 10);
		setTimeout(() => process.exit(1), timeout * 1000).unref();
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}
