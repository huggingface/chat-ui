Dev & Run:
- npm run dev            # start Vite dev server
- npm run build          # build SvelteKit app
- npm run preview        # preview built app

Quality:
- npm run check          # svelte-check with tsconfig
- npm run lint           # prettier --check . && eslint .
- npm run format         # prettier --write .
- npm test               # vitest (workspaces configured)

Scripts:
- npm run updateLocalEnv # update .env from scripts/updateLocalEnv.ts
- npm run populate       # seed/sample via scripts/populate.ts
- npm run config         # project config via scripts/config.ts

macOS (Darwin) utils:
- ls, cd, grep, find, sed, rg (ripgrep if installed)
- node, npm, npx

Entry points:
- App: npm run dev / build / preview
- Tests: npm test (or run per-workspace configs in vite.config.ts)