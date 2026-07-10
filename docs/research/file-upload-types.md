# Research: Supporting More Upload File Types (starting with PDF)

_Status: research write-up — no implementation yet. Scope agreed: PDF first, with an architecture that makes adding further types (docx, etc.) easy later._

## Problem statement

Users want to attach documents — most commonly PDFs — to chat messages. Today the app only
meaningfully supports two categories of attachments:

- **Images** (`image/jpeg`, `image/png`), and only when the current model is multimodal.
- **Text-like files** (`text/*`, `application/json`, `application/xml`, `application/csv`),
  which are inlined into the prompt.

Worse than being unsupported, a PDF is **silently dropped** today: the upload endpoint accepts
any MIME type (it only checks size), the file is stored in GridFS and rendered in the UI as an
attachment, but at LLM-request time `prepareFiles.ts` only has an image branch and a
text-allowlist branch — `application/pdf` matches neither, so the model never sees the file.
The user believes the model read their PDF; it did not.

## Current pipeline (as of this research)

### Where each restriction lives

| Restriction                | Value                                                              | Location                                                        |
| -------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Text/doc allowlist         | `text/*`, `application/json`, `application/xml`, `application/csv` | `src/lib/constants/mime.ts` (`TEXT_MIME_ALLOWLIST`)             |
| Default image allowlist    | `image/jpeg`, `image/png`                                          | `src/lib/constants/mime.ts` (`IMAGE_MIME_ALLOWLIST_DEFAULT`)    |
| Per-model image mimes      | `["image/*"]` (inferred from router) or model override             | `src/lib/server/models.ts` (`multimodalAcceptedMimetypes`)      |
| Active client set          | text allowlist ∪ (images if model multimodal)                      | `src/lib/components/chat/ChatWindow.svelte` (`activeMimeTypes`) |
| Drag-and-drop enforcement  | wildcard MIME match + 10 MB limit                                  | `src/lib/components/chat/FileDropzone.svelte`                   |
| Paste enforcement          | wildcard MIME match vs `activeMimeTypes`                           | `src/lib/components/chat/ChatWindow.svelte` (paste handler)     |
| File-input `accept`        | `mimeTypes.join(",")`                                              | `src/lib/components/chat/ChatInput.svelte`                      |
| Server upload validation   | **size only** (10 MB hardcoded, "todo: make configurable")         | `src/routes/conversation/[id]/+server.ts`                       |
| Server image processing    | png/jpeg only, ≤ 1 MB, ≤ 1024 px (via `sharp`)                     | `src/lib/server/endpoints/openai/endpointOai.ts`                |
| LLM-payload file filtering | `image/*` → image parts; text allowlist → inline; **else dropped** | `src/lib/server/textGeneration/utils/prepareFiles.ts`           |

### Flow

1. **Attach** — file picker, drag-and-drop, paste, or URL fetch (`/api/fetch-url`, SSRF-safe
   proxy). All gated client-side against `activeMimeTypes`; there is no server-side MIME check.
2. **Upload** — files are base64-encoded and POSTed with the message to
   `/conversation/[id]`; `uploadFile.ts` sha256-hashes them, sniffs the real MIME with
   `file-type`, and stores them in a GridFS bucket keyed `{convId}-{sha}`.
3. **LLM prep** — `prepareMessagesWithFiles()` in
   `src/lib/server/textGeneration/utils/prepareFiles.ts` turns files into OpenAI message
   content:
   - `image/*` files → resized/converted by the image processor, sent as base64
     `image_url` data-URL parts (multimodal models only);
   - text-allowlist files → decoded to UTF-8 and prepended to the user message as
     `<document name="..." type="...">…</document>` blocks;
   - **anything else is silently ignored.**
4. **Capabilities & routing** — `models.ts` infers `multimodal` from the HF router's
   `architecture.input_modalities` (only `image`/`vision` are recognized); the Omni router
   (`src/lib/server/router/endpoint.ts`) only treats `image/*` files as a multimodal signal.
   There is **no document/PDF capability flag anywhere** in the model metadata, and the router
   `/models` listing does not advertise one.
5. **MCP** — uploaded files are exposed to MCP tools via short refs
   (`src/lib/server/textGeneration/mcp/fileRefs.ts`), but only an image ref kind is registered.
   The mechanism is explicitly written to support more kinds later.

There is no document-parsing or text-extraction dependency in `package.json` today.

## Options considered

### Option 1 — Server-side text extraction → `<document>` injection ⭐ recommended

Extract the PDF's text on the server at LLM-prep time and inject it through the **existing**
`<document>` path that text files already use.

- ✅ Works with **every** model — non-multimodal models, the Omni router, and any
  `OPENAI_BASE_URL` backend — because the model only ever sees plain text.
- ✅ Smallest diff: one new branch in `prepareFiles.ts`, one allowlist entry, one pure-JS
  dependency. No model-capability changes, no router changes, no message-schema changes.
- ✅ Cheap in tokens compared to sending page images.
- ❌ Loses layout, tables-as-structure, and figures (text order can be imperfect).
- ❌ Scanned/image-only PDFs yield no text (no OCR). Needs graceful degradation.
- ❌ Long PDFs can blow the context window — needs a per-file character budget with an
  explicit truncation marker.

### Option 2 — Rasterize pages → `image_url` parts

Render each page to an image and reuse the existing image pipeline.

- ✅ Preserves layout exactly; handles scanned documents; leverages vision models' strong
  document understanding.
- ❌ Multimodal models only (and the router would need to learn that PDFs imply multimodal).
- ❌ Token-expensive: every page is an image; needs page caps.
- ❌ PDF rendering in Node needs native dependencies (`node-canvas`, or `sharp` built with
  poppler support — not the default build), which complicates the Docker image and any
  serverless deployment.

### Option 3 — Native pass-through (OpenAI `file` content part)

Send the raw PDF as a `{ type: "file", file: { filename, file_data } }` content part and let
the provider do extraction/vision itself.

- ✅ Near-zero code; best quality where supported (provider-side layout-aware parsing).
- ❌ HF router providers do not generally accept file parts today, and the router's
  `input_modalities` gives no signal to detect support — requests would fail unpredictably.
- ❌ Not portable across arbitrary OpenAI-compatible backends, which chat-ui explicitly
  targets. Would require a hand-maintained per-model opt-in flag.

### Option 4 — Hybrid (Option 1 + image fallback for scanned PDFs)

Extract text by default; if extraction yields (almost) nothing and the model is multimodal,
fall back to rasterizing pages.

- ✅ Best coverage overall.
- ❌ Combines the complexity and deployment costs of Options 1 **and** 2.
- Verdict: sensible **v2**, not v1. Option 1's architecture should leave room for it.

## Library evaluation (for Option 1)

| Library      | Verdict | Notes                                                                                                                                              |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unpdf`      | ✅ pick | UnJS wrapper around Mozilla pdf.js. Pure JS, **zero native deps**, built for Node/serverless/edge, actively maintained, small API (`extractText`). |
| `pdf-parse`  | ❌      | Most popular but stale; wraps an old pdf.js build and pulls in an optional native `canvas` dependency that breaks serverless builds.               |
| `pdfjs-dist` | ❌      | Mozilla's full renderer — viewer-oriented, heavier API; `unpdf` already wraps it with the ergonomics we want.                                      |

Sources: [unjs/unpdf](https://github.com/unjs/unpdf),
[unpdf on npm](https://www.npmjs.com/package/unpdf),
[pdf-parse on npm](https://www.npmjs.com/package/pdf-parse),
[unpdf vs pdf-parse vs pdf.js comparison (2026)](https://www.pkgpulse.com/blog/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-parsing-extraction-nodejs-2026),
[serverless PDF processing: unpdf vs pdf-parse](https://chudi.dev/blog/serverless-pdf-processing-unpdf-vs-pdfparse).

## Recommendation

**v1: Option 1 (text extraction with `unpdf`), structured so Option 4 can follow.**

### Implementation sketch (v1)

1. **`src/lib/constants/mime.ts`** — add a `DOCUMENT_MIME_ALLOWLIST = ["application/pdf"]`
   (separate from `TEXT_MIME_ALLOWLIST` so document types can grow independently).
2. **`src/lib/components/chat/ChatWindow.svelte`** — include the document allowlist in
   `activeMimeTypes` for **all** models (extraction makes PDFs model-agnostic). Update the
   `ChatInput.svelte` attach menu copy ("Add file" instead of "Add text file").
3. **`src/lib/server/textGeneration/utils/prepareFiles.ts`** — add a document branch:
   extract text with `unpdf`'s `extractText()`, wrap it in the existing
   `<document name="..." type="...">` block. Apply a per-file character budget
   (e.g. ~100k chars, configurable) and append an explicit
   `[truncated: N of M pages included]` marker when exceeded.
   Extraction happens at LLM-prep time — the raw file is already in GridFS, so uploads stay
   fast and no message-schema change is needed. (Extracted-text caching can be added later if
   re-extraction on every turn shows up in latency.)
4. **Graceful degradation** — if extraction yields ~no text, inject a short note instead
   (`<document …>[This PDF appears to be scanned or contains no extractable text.]</document>`)
   so the model can tell the user rather than hallucinating content.
5. **`src/routes/conversation/[id]/+server.ts`** — add server-side MIME validation against
   the union of allowlists on upload (closes the existing client-only-validation gap), and
   consider making the 10 MB limit configurable while touching it.
6. **Tests** — unit tests for the new `prepareFiles.ts` branch (normal PDF, scanned PDF,
   oversized PDF/truncation) using small fixture PDFs; these run in the existing "server
   tests" Vitest workspace.

### Future extensions (explicitly out of v1 scope)

- **Scanned-PDF fallback to page images** for multimodal models (Option 4) — would also need
  the Omni router's multimodal detection (`hasImageInput` in `router/endpoint.ts`) extended.
- **More document types**: docx via `mammoth`, xlsx via `xlsx`/`exceljs` — each is just a new
  entry in `DOCUMENT_MIME_ALLOWLIST` plus an extractor in the document branch.
- **MCP document refs**: register a `document` ref kind in
  `src/lib/server/textGeneration/mcp/fileRefs.ts` so MCP tools can receive PDFs.
- **Native file parts** as a per-model opt-in (`MODELS` override flag) once HF router
  providers advertise document input.

## Open questions

1. **Limits** — is 10 MB the right upload cap for PDFs, and what character/page budget should
   extraction use before truncating? (Both should probably be env-configurable.)
2. **UX on failure** — is the in-prompt "scanned PDF" note enough, or should the UI surface
   extraction failures to the user directly (e.g. a warning chip on the attachment)?
3. **HuggingChat vs self-hosted** — should PDF support ship enabled everywhere, or behind a
   config flag initially (per the `publicConfig.isHuggingChat` convention)?
4. **Re-extraction cost** — extraction runs on every generation turn that includes the file in
   history; do we cache extracted text (e.g. alongside the GridFS file) from day one or wait
   for real latency data?
