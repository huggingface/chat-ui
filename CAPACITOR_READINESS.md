# Capacitor Build Readiness Assessment

**Date:** 2026-03-02
**Status:** Partially Ready — SPA foundation is solid, backend server still required

## Executive Summary

The chat-ui app has completed the foundational work for Capacitor/Tauri support via the
"chat-ui in tauri" milestone (9 merged PRs). The static adapter is installed and
`npm run build:static` produces valid SPA output. However, a running Node.js backend
is still required — the app cannot function as a standalone client-only mobile app.

## What's Already Capacitor-Ready

| Area                 | Status | Detail                                                                |
| -------------------- | ------ | --------------------------------------------------------------------- |
| Static adapter       | Ready  | `@sveltejs/adapter-static` installed, `npm run build:static` works    |
| SPA routing          | Ready  | `fallback: "index.html"`, `strict: false` configured                  |
| No +page.server.ts   | Ready  | Zero server-side page load files — all loads are universal            |
| No +layout.server.ts | Ready  | Zero server layout files                                              |
| UI components        | Ready  | 80+ Svelte components are pure client-side, zero server imports       |
| HTML template        | Ready  | Viewport already set for mobile (`maximum-scale=1, user-scalable=no`) |
| Icons/assets         | Ready  | Multiple icon sizes in `static/`, PWA manifest configured             |
| TypeScript target    | Ready  | ES2018 — compatible with Capacitor WebViews                           |
| Theme detection      | Ready  | Dark mode via localStorage + `matchMedia` with proper fallback        |

## Architecture

The Capacitor build is a **hybrid architecture**: Capacitor wraps the static SPA frontend,
which talks to a remote Node.js backend over HTTPS.

```
┌─────────────────────────────────┐
│  CAPACITOR APP (iOS/Android)    │
│  Static SPA via adapter-static  │
│  UI components, stores, routing │
│  Talks to remote API via HTTPS  │
└──────────────┬──────────────────┘
               │ HTTPS + Auth Token
               ▼
┌─────────────────────────────────┐
│  NODE.JS BACKEND (unchanged)    │
│  47 API routes, MongoDB, Auth   │
│  LLM proxy, MCP, file storage   │
└─────────────────────────────────┘
```

## Critical Blockers

### 1. API Client hardcodes origin-relative URLs

**File:** `src/lib/APIClient.ts`

```typescript
const baseUrl = browser
	? `${window.location.origin}${base}/api/v2`
	: `${origin ?? "http://localhost:5173"}${base}/api/v2`;
```

In Capacitor, `window.location.origin` becomes `capacitor://localhost`, which won't reach
any backend. The API client needs a configurable base URL (e.g., via `PUBLIC_API_BASE_URL`).

### 2. Root layout makes 6 mandatory API calls on every page load

**File:** `src/routes/+layout.ts`

Calls: `user/settings`, `models`, `user`, `public-config`, `feature-flags`, and
`conversations`. All 47 server endpoints must be reachable — the app is non-functional
without them.

### 3. Authentication requires server-side sessions

The `hooks.server.ts` middleware validates sessions via MongoDB on every request. OAuth
redirects, token refresh, and session cookies all require server mediation.

## Browser API Compatibility Issues

| API                              | Severity | Issue                                              |
| -------------------------------- | -------- | -------------------------------------------------- |
| `window.location.origin`         | Critical | Returns `capacitor://localhost` in native context  |
| Relative fetch URLs              | Critical | `/conversation/[id]` won't resolve without backend |
| `document.cookie`                | High     | May not work in WebView                            |
| `MediaRecorder` / `getUserMedia` | High     | Needs Capacitor microphone plugin                  |
| `ReadableStream.pipeThrough`     | High     | Some Android WebViews lack support                 |
| `localStorage`                   | Medium   | Works but no encryption, cleared on app updates    |
| Hardcoded `huggingface.co` URLs  | Medium   | Fail offline, can't be overridden                  |

## Remaining Work

| Task                           | Effort | Detail                                                 |
| ------------------------------ | ------ | ------------------------------------------------------ |
| Make API base URL configurable | Small  | Add `PUBLIC_API_BASE_URL` to `APIClient.ts`            |
| Add CORS for Capacitor origin  | Small  | Backend must accept `capacitor://localhost`            |
| Handle cookie-less auth        | Medium | Bearer token auth or WebView cookie jar                |
| Add `capacitor.config.ts`      | Small  | Point `webDir` to static build output                  |
| Install Capacitor packages     | Small  | `@capacitor/core`, `@capacitor/cli`, platform packages |
| iOS safe area CSS              | Small  | `env(safe-area-inset-*)` for notch/home indicator      |
| Voice recording plugin         | Medium | Replace raw `getUserMedia` with Capacitor plugin       |
| Test streaming on Android      | Medium | Verify `ReadableStream` + `TextDecoderStream`          |
| Handle deep links for OAuth    | Medium | Register URL scheme for login redirect                 |

## Prior Art

### Merged PRs (SPA foundation)

- **#2059** — Dual adapter support (Node + Static) via `ADAPTER=static`
- **#2058** — Converted last server loads to universal loads
- **#1699** — Replaced all server-side load functions with universal loads
- **#1698** — Replaced all form actions with API endpoints
- **#1743** — New API & universal load functions
- **#1700** — Ensured the app works as SPA

### Closed PR

- **#2046** — Direct Capacitor iOS PR (closed, superseded by modular approach above)

### Open Issues

- **#1722** — Request for native Android app on Play Store
- **#1832** — Request for iPad/Mac layouts of App Store app

## Estimated Effort

**1-2 weeks** to get a working Capacitor build, assuming a deployed backend is available.
The team's stated direction is Tauri rather than Capacitor, but the SPA infrastructure
supports both equally.
