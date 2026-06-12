const defaultTheme = require("tailwindcss/defaultTheme");
const colors = require("tailwindcss/colors");

/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: "class",
	mode: "jit",
	content: ["./src/**/*.{html,js,svelte,ts}"],
	theme: {
		extend: {
			colors: {
				gray: {
					50: "#fafafa",
					100: "#f5f5f5",
					200: "#e5e5e5",
					300: "#d4d4d4",
					400: "#a3a3a3",
					500: "#737373",
					600: "#454545",
					700: "#2e2e2e",
					800: "#1a1a1a",
					900: "#0a0a0a",
					950: "#000000",
				},
			},
			fontSize: {
				xxs: "0.625rem",
				smd: "0.94rem",
			},
			typography: ({ theme }) => ({
				DEFAULT: {
					css: {
						"--tw-prose-body": theme("colors.gray[700]"),
						"--tw-prose-headings": theme("colors.gray[900]"),
						"--tw-prose-lead": theme("colors.gray[600]"),
						"--tw-prose-links": theme("colors.gray[900]"),
						"--tw-prose-bold": theme("colors.gray[900]"),
						"--tw-prose-counters": theme("colors.gray[500]"),
						"--tw-prose-bullets": theme("colors.gray[300]"),
						"--tw-prose-hr": theme("colors.gray[200]"),
						"--tw-prose-quotes": theme("colors.gray[900]"),
						"--tw-prose-quote-borders": theme("colors.gray[200]"),
						"--tw-prose-captions": theme("colors.gray[500]"),
						"--tw-prose-kbd": theme("colors.gray[900]"),
						"--tw-prose-kbd-shadows": "10 10 10",
						"--tw-prose-code": theme("colors.gray[900]"),
						"--tw-prose-pre-code": theme("colors.gray[200]"),
						"--tw-prose-pre-bg": theme("colors.gray[800]"),
						"--tw-prose-th-borders": theme("colors.gray[300]"),
						"--tw-prose-td-borders": theme("colors.gray[200]"),
						"--tw-prose-invert-body": theme("colors.gray[300]"),
						"--tw-prose-invert-lead": theme("colors.gray[400]"),
						"--tw-prose-invert-counters": theme("colors.gray[400]"),
						"--tw-prose-invert-bullets": theme("colors.gray[600]"),
						"--tw-prose-invert-hr": theme("colors.gray[700]"),
						"--tw-prose-invert-quotes": theme("colors.gray[100]"),
						"--tw-prose-invert-quote-borders": theme("colors.gray[700]"),
						"--tw-prose-invert-captions": theme("colors.gray[400]"),
						"--tw-prose-invert-pre-code": theme("colors.gray[300]"),
						"--tw-prose-invert-th-borders": theme("colors.gray[600]"),
						"--tw-prose-invert-td-borders": theme("colors.gray[700]"),
						h2: { marginTop: "1em" },
						h3: { marginTop: "0.8em" },
					},
				},
			}),
		},
	},
	plugins: [
		require("tailwind-scrollbar")({ nocompatible: true }),
		require("@tailwindcss/typography"),
	],
};
