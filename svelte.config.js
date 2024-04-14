import adapter from '@sveltejs/adapter-vercel';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.local' });
dotenv.config({ path: './.env' });

process.env.PUBLIC_VERSION = process.env.npm_package_version;

export default defineConfig({
  kit: {
    adapter: adapter(),

    // Opt-in to hydration
    hydrate: true,

    // Set paths
    paths: {
      base: process.env.APP_BASE || '',
    },

    // Opt-out of built-in CSRF protection
    csrf: false,

    // Configure Vite
    vite: () => ({
      plugins: [svelte()],
    }),
  },
});
