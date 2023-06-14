const defaultTheme = require("tailwindcss/defaultTheme");
const colors = require("tailwindcss/colors");

import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

/** @type {import('tailwindcss').Config} */
export default {
	darkMode: "class",
	content: ["./src/**/*.{html,js,svelte,ts}"],
	theme: {
		extend: {
			colors: {
				primary: process.env.PUBLIC_THEME === "huggingchat" ? colors.yellow : colors.blue,
			},
			// fontFamily: {
			// 	sans: ['"Inter"', ...defaultTheme.fontFamily.sans]
			// },
			fontSize: {
				xxs: "0.625rem",
				smd: "0.94rem",
			},
		},
	},
	plugins: [
		require("tailwind-scrollbar")({ nocompatible: true }),
		require("@tailwindcss/typography"),
	],
};
