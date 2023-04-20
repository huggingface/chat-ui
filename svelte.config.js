import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/kit/vite';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.local' });
dotenv.config({ path: './.env' });

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter(),

		paths: {
			base: process.env.APP_BASE || ''
		}
	}
};

export default config;
