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
				'pink': {
					'50': "#ffe2f6",
					'100': "#ffb3e0",
					'200': "#ff82c9",
					'300': "#ff51b3",
					'400': "#ff30cc",
					'500': "#ff0eb5",
					'600': "#ff00d1",
					'700': "#ff0a87",
					'800': "#ff00d1",
					'900': "#ff065c",
				  },
			  },
			textColor: {
				'gray': {
					'50': "#ffe2f6",
					'100': "#ffb3e0",
					'200': "#ff82c9",
					'300': "#ff51b3",
					'400': "#ff30cc",
					'500': "#ff0eb5",
					'600': "#ff00d1",
					'700': "#ff0a87",
					'800': "#ff00d1",
					'900': "#ff065c",
				  },
			  },
			borderColor: {
				'gray': {
					'50': "#ffe2f6",
					'100': "#ffb3e0",
					'200': "#ff82c9",
					'300': "#ff51b3",
					'400': "#ff30cc",
					'500': "#ff0eb5",
					'600': "#ff0c9e",
					'700': "#ff0a87",
					'800': "#ff0771",
					'900': "#ff065c",
				  },
			  },
			placeholderColor: {
				'gray': {
					'50': "#ffe2f6",
					'100': "#ffb3e0",
					'200': "#ff82c9",
					'300': "#ff51b3",
					'400': "#ff30cc",
					'500': "#ff0eb5",
					'600': "#ff0c9e",
					'700': "#ff0a87",
					'800': "#ff0771",
					'900': "#ff065c",
				  },
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
