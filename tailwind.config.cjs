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
				primary: colors[process.env.PUBLIC_APP_COLOR],
				gray: {
					50: "#E3E3E4",
					100: "#D9D9DA",
					200: "#C4C4C6",
					300: "#AFAFB2",
					400: "#9A9A9E",
					500: "#85858A",
					600: "#717175",
					700: "#5D5D61",
					800: "#49494C",
					900: "#353537",
					950: "#272729",
				},
				yellow: {
					50: "#FFFCF0",
					100: "#FFFBE6",
					200: "#FEF5C7",
					300: "#FEF1AE",
					400: "#FEEC90",
					500: "#FEE777",
					600: "#FEE35D",
					700: "#FDDE3F",
					800: "#FDDA24",
					900: "#8E7601",
					950: "#473B01",
				},
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
