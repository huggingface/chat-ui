import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import Icons from "unplugin-icons/vite";
import fs from 'fs';

export default defineConfig({
    server: {
        https: {
            key: fs.readFileSync('./resource/crt/privkey.pem'),
            cert: fs.readFileSync('./resource/crt/fullchain.pem'),
        },
    },
    plugins: [
        sveltekit(),
        Icons({
            compiler: "svelte",
        }),
    ],
});
