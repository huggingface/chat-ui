module.exports = {
	root: true,
	parser: "@typescript-eslint/parser",
	extends: [
		"eslint:recommended",
		"plugin:@typescript-eslint/recommended",
		"plugin:svelte/recommended",
		"prettier",
	],
	plugins: ["svelte3", "@typescript-eslint"],
	ignorePatterns: ["*.cjs"],
	overrides: [
		{
			files: ["*.svelte"],
			parser: "svelte-eslint-parser",
			parserOptions: {
				parser: "@typescript-eslint/parser",
			},
		},
	],
	parserOptions: {
		sourceType: "module",
		ecmaVersion: 2020,
		extraFileExtensions: [".svelte"],
	},
	rules: {
		"no-shadow": ["error"],
		"@typescript-eslint/no-explicit-any": "error",
		"@typescript-eslint/no-non-null-assertion": "error",
	},
	env: {
		browser: true,
		es2017: true,
		node: true,
	},
};
