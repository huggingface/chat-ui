/**
 * @type { import("@inlang/core/config").DefineConfig }
 */
export async function defineConfig(env) {
	const { default: sdkPlugin } = await env.$import(
		"https://cdn.jsdelivr.net/npm/@inlang/sdk-js-plugin/dist/index.js"
	);
	const { default: ideExtensionPlugin } = await env.$import(
		"https://cdn.jsdelivr.net/npm/@inlang/ide-extension-plugin@latest/dist/index.js"
	);

	return {
		referenceLanguage: "en",
		plugins: [
			sdkPlugin({
				languageNegotiation: {
					strategies: [{ type: "localStorage" }],
				},
				resources: {
					cache: "Build-time",
				},
			}),
			ideExtensionPlugin(),
		],
	};
}
