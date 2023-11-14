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
			// colors: {
			// 	transparent: 'transparent',
			// 	current: 'currentColor',
			// 	'white': '#ffffff',
			// 	'purple': '#3f3cbb',
			// 	'midnight': '#121063',
			// 	'metal': '#565584',
			// 	'tahiti': '#3ab7bf',
			// 	'silver': '#ecebff',
			// 	'bubble-gum': '#ff77e9',
			// 	'bermuda': '#78dcca',
			// 	'gray': '#ff77e9',
			//   },
			backgroundColor: {
				'gray': colors.amber,
				'red': colors.red,
			  },
			textColor: {
				'gray': colors.pink,
			  },
			borderColor: {
				'gray': colors.pink,
			  },
			placeholderColor: {
				'gray': colors.pink,
			  },
			colors: {
				primary: colors[process.env.PUBLIC_APP_COLOR],
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
