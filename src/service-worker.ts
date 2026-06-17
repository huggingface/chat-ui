/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { base, build, files, version } from "$service-worker";

const sw = self as unknown as ServiceWorkerGlobalScope;

// Create a unique cache name for this deployment
const CACHE_NAME = `chat-ui-${version}`;

// Assets to precache (app shell)
const ASSETS = [...build, ...files];

// Install: precache the app shell
sw.addEventListener("install", (event: ExtendableEvent) => {
	async function precache() {
		const cache = await caches.open(CACHE_NAME);
		await cache.addAll(ASSETS);
		// Seed a neutral "/" shell so an offline navigation to an uncached route
		// has a real app shell to fall back to (best-effort: a failure here must
		// not abort the install).
		try {
			await cache.add(`${base}/`);
		} catch {
			// ignore — the shell will be populated on the first online "/" visit
		}
		// Note: we intentionally do NOT skipWaiting() here. A new worker stays in
		// "waiting" so +layout.svelte can surface the "Update Now" banner; it only
		// activates once the client posts SKIP_WAITING (see the message handler),
		// avoiding an unprompted reload that would discard in-progress drafts.
	}
	event.waitUntil(precache());
});

// Activate: clean up old caches
sw.addEventListener("activate", (event: ExtendableEvent) => {
	async function cleanup() {
		const keys = await caches.keys();
		const oldKeys = keys.filter((key) => key !== CACHE_NAME);
		await Promise.all(oldKeys.map((key) => caches.delete(key)));
		// Take control of all clients immediately
		await sw.clients.claim();
	}
	event.waitUntil(cleanup());
});

// Fetch: serve cached assets, network-first for API calls
sw.addEventListener("fetch", (event: FetchEvent) => {
	const url = new URL(event.request.url);
	const isAttachment = url.pathname.match(/\/output\/[a-f0-9]{64}/);
	const isAPI = url.pathname.startsWith("/api/");
	const isAsset = ASSETS.some((asset) => url.pathname === asset);

	// Cache-first for app shell assets
	if (isAsset) {
		event.respondWith(
			caches.match(event.request).then((cached) => {
				return cached ?? fetch(event.request);
			})
		);
		return;
	}

	// Cache-first for attachment blobs (GET /output/[sha256])
	if (isAttachment && event.request.method === "GET") {
		event.respondWith(
			caches.open(CACHE_NAME).then((cache) => {
				return cache.match(event.request).then((cached) => {
					if (cached) return cached;
					return fetch(event.request).then((response) => {
						if (response.ok) {
							cache.put(event.request, response.clone());
						}
						return response;
					});
				});
			})
		);
		return;
	}

	// Network-first for API calls
	if (isAPI) {
		event.respondWith(
			fetch(event.request).catch(() => {
				return caches.match(event.request).then((cached) => {
					if (cached) return cached;
					return new Response(null, { status: 503, statusText: "Offline" });
				});
			})
		);
		return;
	}

	// Navigation requests: network-first, but cache successful responses so the
	// app shell is available offline. SSR pages are never in the precache, so
	// without this write-through an offline reload has no HTML to serve.
	if (event.request.mode === "navigate") {
		event.respondWith(
			fetch(event.request)
				.then((response) => {
					if (response.ok) {
						// Cache each route under its OWN url so an offline reload of that
						// page works. We deliberately do not clone this into the "/" shell:
						// route-specific SSR (e.g. /conversation/:id) embeds private/stale
						// data, and serving it as the generic fallback would leak the wrong
						// conversation. The neutral "/" shell is seeded at install instead.
						const copy = response.clone();
						void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
					}
					return response;
				})
				.catch(() =>
					caches.match(event.request).then((cached) => {
						if (cached) return cached;
						return caches
							.match(`${base}/`)
							.then((root) => root ?? new Response(null, { status: 503, statusText: "Offline" }));
					})
				)
		);
		return;
	}

	// For all other requests, try network first, fall back to cached
	event.respondWith(
		fetch(event.request).catch(() => {
			return caches.match(event.request).then((cached) => {
				if (cached) return cached;
				return new Response(null, { status: 503, statusText: "Offline" });
			});
		})
	);
});

// Listen for SKIP_WAITING message from the client
sw.addEventListener("message", (event: ExtendableMessageEvent) => {
	if (event.data?.type === "SKIP_WAITING") {
		void sw.skipWaiting();
	}
});
