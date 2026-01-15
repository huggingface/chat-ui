import type { CapacitorConfig } from "@capacitor/core";

const config: CapacitorConfig = {
	appId: "co.huggingface.chat",
	appName: "HuggingChat",
	webDir: "build",
	ios: {
		scheme: "HuggingChat",
		contentInset: "automatic",
	},
	plugins: {
		Keyboard: {
			resize: "body",
			resizeOnFullScreen: true,
		},
		SplashScreen: {
			launchShowDuration: 2000,
			launchAutoHide: true,
			backgroundColor: "#000000",
			showSpinner: false,
		},
		StatusBar: {
			style: "dark",
			backgroundColor: "#000000",
		},
	},
	server: {
		// For development, you can point to a local server:
		// url: "http://localhost:5173",
		// For production, the app serves bundled static files
		// and makes API calls to the configured backend
	},
};

export default config;
