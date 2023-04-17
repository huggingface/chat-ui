const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
export default {
	darkMode: 'class',
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			// fontFamily: {
			// 	sans: ['"Inter"', ...defaultTheme.fontFamily.sans]
			// },
			fontSize: {
				smd: '0.94rem'
			}
		}
	},
	plugins: [require('tailwind-scrollbar')({ nocompatible: true })]
};
