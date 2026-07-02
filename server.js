import process from "node:process";
import { handler } from "./build/handler.js";
import polka from "polka";
import compression from "@polka/compression";

// SvelteKit's adapter-node docs recommend @polka/compression over the more popular
// `compression` package because SvelteKit streams responses and `compression`'s
// streaming implementation has a long-standing unresolved bug (expressjs/compression#183).
// @polka/compression's own defaults are still unsafe for this app though:
//   - its default `mimes` regex matches both application/jsonl (via the "/json" substring)
//     and text/event-stream (via "text"), so token-streamed responses would get buffered
//     inside the gzip/brotli transform instead of delivered as they're produced.
//   - its brotli `level` defaults to -1, which resolves to BROTLI_MAX_QUALITY (11) instead
//     of a balanced default, making dynamic compression expensive on every request.
//   - it never sets `Vary: Accept-Encoding`, so a downstream cache could serve a
//     compressed body to a client that sent no Accept-Encoding.
const mimes =
	/^(?!application\/jsonl(?:;|$))(?!text\/event-stream(?:;|$)).*(?:text|javascript|\/json|xml)/i;

const compress = compression({
	threshold: 1024,
	gzip: true,
	brotli: true,
	level: 4,
	mimes,
});

// SvelteKit writes its own headers late (res.writeHead with a full header
// object, e.g. `Vary: Accept` on routes that have both a page and a
// co-located +server.ts), which would silently overwrite a Vary header set
// up-front by middleware. Merge "Accept-Encoding" into any Vary value at
// set-time instead, whichever code path writes it.
function keepVaryAcceptEncoding(res) {
	const mergeVary = (value) =>
		[
			...new Set(
				String(value ?? "")
					.split(",")
					.map((part) => part.trim())
					.filter(Boolean)
					.concat("Accept-Encoding")
			),
		].join(", ");
	const setHeader = res.setHeader.bind(res);
	res.setHeader = (name, value) =>
		String(name).toLowerCase() === "vary"
			? setHeader(name, mergeVary(value))
			: setHeader(name, value);
	const writeHead = res.writeHead.bind(res);
	res.writeHead = (status, ...rest) => {
		for (const arg of rest) {
			if (arg && typeof arg === "object" && !Array.isArray(arg)) {
				for (const key of Object.keys(arg)) {
					if (key.toLowerCase() === "vary") arg[key] = mergeVary(arg[key]);
				}
			}
		}
		return writeHead(status, ...rest);
	};
	setHeader("Vary", "Accept-Encoding");
}

const server = polka()
	.use((req, res, next) => {
		keepVaryAcceptEncoding(res);
		next();
	})
	.use(compress)
	.use(handler);

// Mirrors the env vars adapter-node's generated build/index.js reads, since a custom
// server doesn't get that lifecycle handling for free (see adapter-node docs: "Server
// lifecycle variables must be implemented separately").
const path = process.env.SOCKET_PATH;
const host = process.env.HOST ?? "0.0.0.0";
const port = process.env.PORT ?? "3000";
const shutdownTimeout = parseInt(process.env.SHUTDOWN_TIMEOUT ?? "30", 10);

// Node treats any listen-options object carrying host/port as a TCP listen
// (empirically, `{ path, host, port: undefined }` binds a random TCP port and
// never creates the socket), so the socket path must be the only key present
// when it is configured.
const listenOptions = path ? { path } : { host, port };

server.listen(listenOptions, () => {
	console.log(`Listening on ${path || `http://${host}:${port}`}`);
});

let shutdownTimeoutId;

// Without this, SIGTERM during a rolling deploy kills in-flight requests immediately
// instead of draining them, since the custom server has no shutdown handling by default.
function gracefulShutdown() {
	if (shutdownTimeoutId) return;

	server.server.closeIdleConnections();
	server.server.close(() => {
		if (shutdownTimeoutId) clearTimeout(shutdownTimeoutId);
	});

	shutdownTimeoutId = setTimeout(() => server.server.closeAllConnections(), shutdownTimeout * 1000);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
