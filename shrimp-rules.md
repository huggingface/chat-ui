# Development Guidelines (AI Agent Operational Standards)

> This document is for AI Coding Agents. Use imperative rules. Do not include general programming knowledge.

## Project Overview

- SvelteKit (v2) + Svelte 5 + TypeScript (strict) + Vite (v6) + Tailwind.
- Node adapter deployment. Aliases: `$api -> src/lib/server/api`.
- Lint and format enforced via npm scripts. Testing via Vitest workspaces.

### Related Rule Files

- [.cursor/rules/cursor_rules.mdc](mdc:.cursor/rules/cursor_rules.mdc)
- [.cursor/rules/RIPER-5.mdc](mdc:.cursor/rules/RIPER-5.mdc)
- [.cursor/rules/initial_config_mandate.mdc](mdc:.cursor/rules/initial_config_mandate.mdc)
- [.cursor/rules/serena/serena_mcp_mandate.mdc](mdc:.cursor/rules/serena/serena_mcp_mandate.mdc)
- [.cursor/rules/codanna/codanna_usage.mdc](mdc:.cursor/rules/codanna/codanna_usage.mdc)
- [.cursor/rules/shrimp/sdd_workflow_mandate.mdc](mdc:.cursor/rules/shrimp/sdd_workflow_mandate.mdc)
- [.cursor/rules/self_improve.mdc](mdc:.cursor/rules/self_improve.mdc)

## Architecture & Paths

- Source root: `src/`
  - `src/lib/` reusable code
    - `src/lib/server/` server-only code and `$api` modules
    - `src/lib/components/` UI components (Svelte)
    - `src/lib/stores/` Svelte stores
    - `src/lib/types/` shared TypeScript types
  - `src/routes/` SvelteKit routes
    - API endpoints under `src/routes/api/**/+server.ts`
    - Pages/layouts under `src/routes/**`
  - `src/styles/` global styles
- Config: `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `.eslintrc.cjs`, `tailwind.config.cjs`.
- Scripts: `scripts/**` (vitest setups, config utilities).

## Code Standards (Mandatory)

- Use TypeScript strict mode; add explicit types for exported APIs.
- Use type-only imports. Enforce: `@typescript-eslint/consistent-type-imports`.
- Forbid: `any`, non-null assertions (`!`), unused vars (prefix unused args with `_`).
- Enforce: `eqeqeq` (smart), `prefer-const`, `no-var`, `curly: all`, `object-shorthand: always`.
- Console: `console.warn` and `console.error` allowed; avoid other `console.*`.
- Prettier formatting:
  - Use tabs; print width 100. Keep Svelte and Tailwind plugins enabled.
  - Never mix tabs/spaces. Do not reformat unrelated code.
- Match existing naming: functions as verbs; descriptive, full-word identifiers.

References: [ESLint config](mdc:.eslintrc.cjs), [tsconfig.json](mdc:tsconfig.json).

## Svelte 5 (Runes) Rules

- Prefer `$state`, `$derived`, `$props` per Svelte 5 patterns.
- Keep reactive state minimal and colocated within components.
- Do not leave unused runes; remove dead state/derivations.
- Avoid direct DOM manipulation; use Svelte bindings and actions.

## UI & Markup Security

- Rendering raw HTML requires sanitization.
  - Mandatory: sanitize with DOMPurify before using `{@html ...}`.
  - Allowed exception: only when content is already sanitized in the same file.
  - Inline rule disable for `svelte/no-at-html-tags` is allowed only alongside `DOMPurify.sanitize(...)` in the same line/block.
- Example:

```svelte
<script lang="ts">
 import DOMPurify from "isomorphic-dompurify";
 export let html: string;
</script>

{@html DOMPurify.sanitize(html)}
```

Do NOT:

```svelte
{@html html} // forbidden
```

References: [CodeBlock.svelte](mdc:src/lib/components/CodeBlock.svelte)

### Security-in-Markup Scanner (Plan)

- Purpose: Detect unsafe `{@html ...}` usage and enforce `DOMPurify.sanitize(...)`.
- Scope: `src/**/*.svelte` (exclude `src/lib/server/**`).
- Detection rules:
  - Violation: `{@html <expr>}` where `<expr>` is NOT `DOMPurify.sanitize(...)`.
  - Normal: `{@html DOMPurify.sanitize(expr)}`.
  - Exception (explicitly allowed): same-file justification comment present — `<!-- safe-html: reason -->`.
- Output: console table or JSONL (`file:line:summary`). Exit code 1 if violations, 0 otherwise.
- Execution (planned): `scripts/scan-html.ts` with `npm run scan:html` (add in CI once implemented).
- Acceptance criteria: 0 violations required for merge; exceptions must include justification comment.
- Limitations: static scan; indirect/dynamic constructions may need manual review.

## Server & API Standards

- Use `$api` alias for server API modules.
  - Import types as type-only where applicable.
- Validate all external inputs at boundaries.
  - Prefer `zod` for request/response schemas.
- API endpoints:
  - Place at `src/routes/api/<scope>/+server.ts`.
  - Implement method handlers (`GET`, `POST`, etc.) with explicit return types.
  - Convert thrown errors to appropriate HTTP status codes.
- For server-side utilities, place in `src/lib/server/**` and avoid leaking server code to browser.

References: [svelte.config.js](mdc:svelte.config.js), [APIClient.ts](mdc:src/lib/APIClient.ts)

## Routing & Files

- Page routes: `src/routes/**/+page.svelte|ts`.
- Server endpoints: `src/routes/**/+server.ts`.
- Co-locate `+page.ts` load logic with `+page.svelte` when data is required.
- Keep API route schemas/types in `src/lib/types/` when shared by client and server.

## Environment & CSP

- Env loading: `.env.local` (override) then `.env`.
- Public browser-exposed vars must be prefixed with `PUBLIC_`.
- Iframe policy: blocked by default via CSP `frame-ancestors 'none'`.
  - To allow iframes, set `ALLOW_IFRAME=true` in env; review CSP needs for additional directives.
- CSRF: origin check is handled in `hooks.server.ts`; do not reintroduce framework defaults.

References: [svelte.config.js](mdc:svelte.config.js), [hooks.server.ts](mdc:src/hooks.server.ts)

## Vite & Dev Server

- Icons via `unplugin-icons`; do not add runtime icon packs unnecessarily.
- Custom TTF loader exists for thumbnails; preserve it when modifying Vite plugins.
- `server.allowedHosts` is restricted; do not broaden without security review.

References: [vite.config.ts](mdc:vite.config.ts)

## Testing

- Use Vitest workspaces:
  - Client (browser): `src/**/*.svelte.{test,spec}.{ts}`; setup `scripts/setups/vitest-setup-client.ts`.
  - SSR: `src/**/*.ssr.{test,spec}.{ts}`.
  - Server (node): `src/**/*.{test,spec}.{ts}` excluding Svelte tests; setup `scripts/setups/vitest-setup-server.ts`.
- Prefer unit tests for logic in `src/lib/**` and integration tests for routes.

References: [vite.config.ts](mdc:vite.config.ts), [scripts/setups](mdc:scripts/setups)

## Workflow

- Before commit:
  - `npm run check` (svelte-check)
  - `npm run lint`
  - `npm run format` (only for intentional reformat)
  - `npm test`
- Keep changes atomic and scoped; update related files in the same edit.

### Combined Check (Optional)

- `npm run rules:check` (runs: check → lint → test)

## MCP Servers & Restart Procedure

- Registered MCP servers (see [.cursor/mcp.json](mdc:.cursor/mcp.json)):
  - Serena: `uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context ide-assistant --mode interactive`
  - Codanna: `codanna serve --watch`
  - Shrimp Task Manager: `node /Users/sukbeom/Documents/mcp-shrimp-task-manager/dist/index.js` (env: `DATA_DIR`, `TEMPLATES_USE=ko`, `ENABLE_GUI=true`)

- Restart / Reload:
  - Command Palette: “Model Context Protocol: Restart MCP Servers”
  - Or: “Developer: Reload Window”
  - After editing `.cursor/mcp.json`, reload is required.

- Codanna Indexing:
  - Run: `codanna index "/Users/sukbeom/Desktop/workspace/huggingface-ui"`
  - If MCP still shows stale/0 symbols: restart MCP servers and re-check
  - Settings reference: [.codanna/settings.toml](mdc:.codanna/settings.toml)

- Guardrails:
  - Do not broaden `vite.server.allowedHosts` in `vite.config.ts` without security review.
  - Restart MCP servers after changes to `.cursor/mcp.json` or `.codanna/settings.toml`.
  - Keep `ALLOW_IFRAME` gating in `svelte.config.js` unchanged unless explicitly required.

- Troubleshooting:
  - CLI index updated but MCP shows 0 symbols → restart MCP servers.
  - Ensure `.codanna/settings.toml` `indexed_paths` includes the workspace root.

## Codanna Index Maintenance

- When to (Re)Index:
  - First-time setup or after large refactors / mass file moves
  - MCP shows outdated/0 symbols vs CLI output
  - After changing `.codanna/settings.toml` (e.g., `indexed_paths`, `ignore_patterns`)

- Commands:
  - Initial/Manual index:
    - `codanna index "/Users/sukbeom/Desktop/workspace/huggingface-ui"`
  - Verify index via MCP:
    - Restart MCP servers, then use Codanna “Get Index Info” to check symbol counts

- Settings Reference:
  - [.codanna/settings.toml](mdc:.codanna/settings.toml)
  - Ensure `indexed_paths` includes the project root
  - Keep `ignore_patterns` strict (e.g., `node_modules/**`, `.git/**`) for performance

- Operational Notes:
  - Keep `codanna serve --watch` running (registered in `.cursor/mcp.json`)
  - After editing `.cursor/mcp.json` or `.codanna/settings.toml`, restart MCP servers

- Troubleshooting:
  - “CLI index OK, MCP shows 0” → Restart MCP servers and re-check
  - “Slow or partial index” → Review `ignore_patterns`, reduce scope, re-run index
  - “Wrong path indexed” → Confirm absolute workspace path in the index command and settings

## Key File Interaction Standards

- When updating `$api` request/response types:
  - Update shared types in `src/lib/types/**` if used by client code.
  - Update corresponding route handlers in `src/routes/api/**/+server.ts`.
  - Update client usage in `src/lib/APIClient.ts` (or relevant clients) to match type changes.
- When enabling iframes:
  - Set `ALLOW_IFRAME=true` in env.
  - Verify CSP behavior and add any required directives in `svelte.config.js`.
- When introducing `@html` in any component:
  - Add DOMPurify sanitization as shown above.

## API Contract Change Checklist

- Update shared types under `src/lib/types/**` (request/response DTOs, enums, type aliases).
- Update server handlers under `src/routes/api/**/+server.ts` and validate inputs/outputs with `zod`.
- Update client usage in `src/lib/APIClient.ts` and all callers to match the new types/contracts.
- Update affected UI/data loaders (e.g., `+page.ts`, components) that depend on the changed contract.
- Update tests across workspaces:
  - Client/browser (`src/**/*.svelte.{test,spec}.{ts}`)
  - SSR (`src/**/*.ssr.{test,spec}.{ts}`)
  - Server/node (`src/**/*.{test,spec}.{ts}` excluding Svelte tests)
- Backward compatibility & release notes:
  - For breaking changes, add deprecation/migration notes in PR description and team release notes.
- Run combined checks: `npm run rules:check` (check → lint → test) and ensure build/preview if needed.

## AI Decision-Making Standards

- Prefer modifying existing utilities in `src/lib/**` before adding new ones.
- Place shared types in `src/lib/types/**`; do not duplicate inline types across modules.
- For cross-component state, use stores under `src/lib/stores/**`.
- For API consumption on the client, prefer existing patterns in [APIClient.ts](mdc:src/lib/APIClient.ts).
- If a change affects types + server handlers + client usage, update all three in one PR/edit.
- Do not alter CSP or dev server host settings without explicit instruction and reasoning.
- For search/analysis, do not use grep or whole-file scans; use Codanna (semantic/symbol) and Serena symbol tools per RIPER-5 S2/S3.

## Prohibited Actions

- Using `any` or non-null assertions.
- Adding `console.log`/`console.info` in committed code.
- Using `{@html ...}` without sanitization.
- Direct DOM manipulation in Svelte components.
- Creating server code in browser-exposed modules.
- Raw `fetch` to backend where a shared client/util already exists.
- Introducing new global state outside `src/lib/stores/**`.

## Examples (Do / Don’t)

- Type-only import

```ts
// Do
import type { ApiResponse } from "$api/types";

// Don’t
// import { ApiResponse } from "$api/types";
```

- Strict equality and const

```ts
// Do
if (count === 0) {
 const value = 1;
}

// Don’t
// if (count == 0) {
//  var value = 1;
// }
```

- API route structure

```ts
// Do: src/routes/api/widgets/+server.ts
export async function POST({ request }) {
 // validate with zod, return json
}

// Don’t: put server handlers in non-+server files
```

## References

- ESLint: [.eslintrc.cjs](mdc:.eslintrc.cjs)
- Prettier: configured via devDependencies; follow workspace rule tabs/width
- Svelte config: [svelte.config.js](mdc:svelte.config.js)
- Vite config & tests: [vite.config.ts](mdc:vite.config.ts)
- API patterns: [APIClient.ts](mdc:src/lib/APIClient.ts), [CodeBlock.svelte](mdc:src/lib/components/CodeBlock.svelte)
