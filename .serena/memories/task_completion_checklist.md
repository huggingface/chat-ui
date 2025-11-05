Before commit:
1) npm run check
2) npm run lint (no new warnings except allowed console.warn/error)
3) npm run format (only for intentional reformat)
4) npm test (all workspaces green)
5) Build verification (optional for feature branches): npm run build

When editing API contracts:
- Update shared types under src/lib/types/**
- Update route handlers under src/routes/api/**/+server.ts
- Update client usage in src/lib/APIClient.ts

Security:
- If adding {@html}, sanitize with DOMPurify first
- If enabling iframes, set ALLOW_IFRAME=true and review CSP in svelte.config.js

Dev server:
- Do not broaden vite.server.allowedHosts without explicit review