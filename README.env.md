Env quickstart
--------------

- Dev XP: npm run dev:xp
- Dev BKK: npm run dev:bkk
- Optional picker: npm run dev:select
- Build XP: npm run build:xp
- Build BKK: npm run build:bkk

XP/BKK scripts copy the matching .env.<mode>.local into .env.local and then run Vite with --mode <mode>. Keep secrets in .env.xp.local or .env.bkk.local (they are git-ignored). If you want to preserve your current .env.local, back it up before switching.
