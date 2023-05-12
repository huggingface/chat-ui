/**
 * @type { import("@inlang/core/config").DefineConfig }
 */
export async function defineConfig(env) {
	const { default: jsonPlugin } = await env.$import(
		"https://cdn.jsdelivr.net/gh/samuelstroschein/inlang-plugin-json@2/dist/index.js"
	);
	const { default: sdkPlugin } = await env.$import(
		"https://cdn.jsdelivr.net/npm/@inlang/sdk-js-plugin@0.4.4/dist/index.js"
	);
	const { default: ideExtensionPlugin } = await env.$import(
		"https://cdn.jsdelivr.net/npm/@inlang/ide-extension-plugin@latest/dist/index.js"
	);

	return {
		referenceLanguage: "en",
		plugins: [
			jsonPlugin({
				pathPattern: "./languages/{language}.json",
			}),

			sdkPlugin({
				languageNegotiation: {
					strategies: [{ type: "localStorage" }],
				},
			}),
			ideExtensionPlugin(),
		],
	};
}
