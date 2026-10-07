# PaperPage Intern

PaperPage Intern is an agent mode that builds a research project page (the page that goes with a paper) together with the user. The page is a SvelteKit project running live in a Hugging Face Space; the user watches it change in the side pane while the agent edits, and the finished page is published as a static Space.

Turn it on with the "PaperPage Intern" switch in the composer of a new conversation (beside ML Intern's; one mode per conversation), or open the deep link `/?mode=paperpage-intern`.

## Enabling

```ini
PAPERPAGE_TEMPLATE_SPACE=blanchon/paperpage-template
# optional: the model the deep link preselects on that page (the user can still switch)
PAPERPAGE_MODEL=deepseek-ai/DeepSeek-V4.1-Flash
```

The mode is on while `PAPERPAGE_TEMPLATE_SPACE` is set. It acts on the Hub with a token that can create Spaces, buckets and Space secrets:

- **With login**, the signed-in user's token is used, so `OPENID_SCOPES` must include `manage-repos` (`write-repos` cannot create repos or secrets). Anonymous visitors cannot start the mode.
- **Without login** (local development), the token of an `MCP_SERVERS` entry for the Hugging Face MCP server (`huggingface.co/mcp`) that carries its own `Authorization` header is used:

```ini
MCP_SERVERS=[{"name":"Hugging Face","url":"https://huggingface.co/mcp?login","headers":{"Authorization":"Bearer hf_***"}}]
```

Workshops are created with **protected** visibility (the page is public and embeddable, the source private), which needs a PRO or Team account. When the Hub refuses it for that reason, the workshop is created public, and its source and `dev` checkpoints are then public too; the agent tells the user.

## How it works

```
chat-ui ──page_* tools──► https://<workshop host>/__sbx/*   (sbx-server, X-Sandbox-Token)
   │                                   │
   │ side pane iframe ────────────────►│ /  (Vite dev server, hot reload)
   │
   └─ @huggingface/hub commits ──► <user>/<name>-dev @ dev   (checkpoints)
                              └──► <user>/<name>             (published static Space)
```

- **Agreement first.** The agent interviews the user one question at a time, each with a recommendation, until they agree on the name, sections, content, components and design. It builds only after an explicit go-ahead.
- **Workshop.** Each conversation gets one Docker Space, `<user>/<name>-dev`, on free `cpu-basic` hardware. It is a new repo holding a copy of the template's files (one commit by the user, not the template's history), with the project's own title, emoji and colours, and a random `SBX_TOKEN` secret. It is only created once the user has replied (answered a question or written again), so its name is always agreed with them. The token lives in the `paperPageWorkshops` collection, never on the conversation document; a creation that fails halfway is resumed on the next call.
- **Template.** The template Space runs [sbx-server](https://github.com/huggingface/sandbox-server), Hugging Face's open-source sandbox agent, next to the Vite dev server. [Caddy](https://caddyserver.com) sits on port 7860 and routes `/__sbx/*` to sbx-server and everything else to Vite, so the agent can still reach the container when the dev server is down.
- **Tools.** `page_workshop` creates, renames or wakes the workshop. `page_exec` runs commands and reads files. `page_write_file` and `page_edit_file` change files and report whether the page still renders, so the preview stays working while the page is built. `page_checkpoint`, `page_publish` and `page_upload_media` write to the Hub. `page_import_attachments` copies the files the user attached into the workshop. The agent checks the page in a headless Chrome in the workshop with [agent-browser](https://github.com/vercel-labs/agent-browser) through `page_exec` (snapshots, clicks, viewports, screenshots, console and errors; the browser stays open between calls). `page_view_image` shows an image from the workshop, such as a screenshot or an extracted figure, to the user and, when the conversation's model reads images, to the model with the next request only. The generic `ask_user_question` and `update_plan` builtins are offered too.
- **Restore.** The container is disposable. The first `page_*` call after a restart or a sleep writes the `dev` branch back into it; calls within the next minute skip that check to stay under the Hub's rate limit.
- **Checkpoints.** Git inside the container only decides what changed; chat-ui reads those files back through sbx-server and commits them with `@huggingface/hub`. The Hub refuses binary files pushed with plain git, and this keeps the Hub token out of the container. Symlinks and any file holding the workshop's own token are refused. A Space only builds `main`, so commits to `dev` never restart the dev server.
- **Publishing.** The first `page_publish` creates `<user>/<name>` (or another new Space of the same owner) as an `sdk: static` Space and fails if the name is taken; later publishes always go to that Space and replace its files. The project's source goes up without the workshop files, with `.hf/README.static.md` as its README, and the Space builds it (`app_build_command: npx -y bun install --frozen-lockfile && npx -y bun run build`), because the Hub's static builder has Node but no bun.
- **Media.** `page_upload_media` puts large files (videos, 3D assets) in a public bucket, `<user>/<name>-media`, and returns their CDN URLs, which support range requests, so videos can seek.
- **Attachments.** In the mode the composer also accepts PDFs, archives, video, audio and 3D files (10 MB each). The model is told only that they exist (`[attached file, not shown to you: …]`) and opens them in the workshop.
- **Variants.** For visual choices the agent builds 2–4 variants and the template's dev-only `VariantPicker` lets the user flip between them live. Once the user picks, the agent deletes the losers and the picker.
- **Trace.** The share dialog's "Download trace" exports the whole conversation as JSON, with the workshop and published Space ids (never the sandbox token).
- **Preview.** A `Preview: https://….hf.space/` line in the output of `page_workshop` or `page_checkpoint` opens the generic `SpacePreviewPane`. Only `*.hf.space` URLs from those tools, in PaperPage conversations, are framed.

## The template

The template is a stock `sv create` project (minimal, TypeScript, `adapter-static`, Tailwind CSS 4 via `sv add tailwindcss`) with `src/lib/dev/VariantPicker.svelte`, plus a Dockerfile that also installs agent-browser and the Chrome it drives, outside the project:

```dockerfile
FROM oven/bun:1-slim
# tools for the agent, then the libraries Chrome needs (agent-browser's own list, minus CJK fonts)
RUN apt-get update && apt-get install -y --no-install-recommends \
	git procps curl file poppler-utils imagemagick ffmpeg unzip \
	libxcb-shm0 libx11-xcb1 libx11-6 libxcb1 libxext6 libxrandr2 libxcomposite1 libxcursor1 libxdamage1 \
	libxfixes3 libxi6 libgtk-3-0 libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 libcairo-gobject2 libcairo2 \
	libgdk-pixbuf-2.0-0 libxrender1 libasound2t64 libfreetype6 libfontconfig1 libdbus-1-3 libnss3 \
	libnspr4 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libatspi2.0-0 libcups2 libxshmfence1 libgbm1 \
	fonts-noto-color-emoji fonts-freefont-ttf \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=caddy:2-alpine /usr/bin/caddy /usr/local/bin/caddy
ADD --chmod=755 --checksum=sha256:eb2b04f79fbe765195300aaf1582be2a2a9ea698ff067d0cab428171d5584932 \
	https://huggingface.co/buckets/huggingface/sbx-server/resolve/sbx-server-74ad0f1 /usr/local/bin/sbx-server
# agent-browser drives a headless Chrome for the agent's checks; Chrome is installed once, shared
ADD --chmod=755 --checksum=sha256:5100149a1903211c889de4e545bf36d90803740cea4f99aa22651649f9205ea1 \
	https://github.com/vercel-labs/agent-browser/releases/download/v0.38.1/agent-browser-linux-x64 /usr/local/bin/agent-browser
RUN HOME=/opt/agent-browser agent-browser install \
	&& ln -s "$(find /opt/agent-browser -type f -name chrome -perm -u+x | head -1)" /usr/local/bin/chrome \
	&& chmod -R a+rX /opt/agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/local/bin/chrome \
	AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage,--disable-gpu
USER bun
WORKDIR /app
COPY --chown=bun . .
RUN bun install --frozen-lockfile
CMD ["sh", ".hf/dev.sh"]
```

What chat-ui relies on:

- `/app` is a git repository. The Hub's Docker build context includes the Space's `.git`, so `COPY . .` brings it along; checkpoints use it to find what changed.
- `.gitignore` covers `.paper/` (raw paper material) and `.media/` (large media before upload), so neither is checkpointed or published.
- `.hf/dev.sh` starts `sbx-server`, unsets `SBX_TOKEN` so nothing else it starts inherits it, starts `caddy`, then runs `bun run dev` in a loop so a dev server that exits comes back by itself. The dev server log is `/tmp/dev.log`.
- `.hf/Caddyfile` routes the traffic and serves a "Dev server starting…" page while Vite is down.
- `.hf/README.static.md` is the frontmatter of the published static Space.
- `agent-browser` finds Chrome through `AGENT_BROWSER_EXECUTABLE_PATH` and gets its headless flags from `AGENT_BROWSER_ARGS`; its `install --with-deps` needs `sudo`, so the Dockerfile installs Chrome's libraries itself.
- `vite.config.ts` only needs `server: { host: "127.0.0.1", port: 5173, strictPort: true, allowedHosts: [".hf.space"] }`. Hot reload works through the `hf.space` proxy without an `hmr` block.
- `package.json`'s `check` script reports errors only (`svelte-check --threshold error`).
- `src/routes/+layout.ts` has `export const prerender = true`, and `+layout.svelte` imports `./layout.css`, which loads Tailwind.

## Limits

- Attachments are limited to 10 MB each by the upload route; larger media come from a URL.
- Workshops created before a template change keep their old image until their `main` is updated.
- The Hub lets an account create 20 Spaces a day; each page uses two (the workshop and the published Space).
- Deleting a conversation leaves its Spaces, its media bucket and its `paperPageWorkshops` record in place.
