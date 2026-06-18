import { config, ready } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { initExitHandler } from "$lib/server/exitHandler";
import { checkAndRunMigrations } from "$lib/migrations/migrations";
import { refreshConversationStats } from "$lib/jobs/refresh-conversation-stats";
import { loadMcpServersOnStartup } from "$lib/server/mcp/registry";
import { AbortedGenerations } from "$lib/server/abortedGenerations";
import { adminTokenManager } from "$lib/server/adminToken";
import { MetricsServer } from "$lib/server/metrics";
import { getShareThumbnailPng } from "$lib/server/shareThumbnail/shareThumbnail";

export async function initServer(): Promise<void> {
	// Wait for config to be fully loaded
	await ready;

	// Ensure legacy env expected by some libs: map OPENAI_API_KEY -> HF_TOKEN if absent
	const canonicalToken = config.OPENAI_API_KEY || config.HF_TOKEN;
	if (canonicalToken) {
		process.env.HF_TOKEN ??= canonicalToken;
	}

	// Warn if legacy-only var is used
	if (!config.OPENAI_API_KEY && config.HF_TOKEN) {
		logger.warn(
			"HF_TOKEN is deprecated in favor of OPENAI_API_KEY. Please migrate to OPENAI_API_KEY."
		);
	}

	logger.info("Starting server...");
	initExitHandler();

	if (config.METRICS_ENABLED === "true") {
		MetricsServer.getInstance();
	}

	checkAndRunMigrations();
	refreshConversationStats();

	// Load MCP servers at startup
	loadMcpServersOnStartup();

	// Init AbortedGenerations refresh process
	AbortedGenerations.getInstance();

	// Warm up the share-thumbnail renderer: the first satori render in a fresh
	// process pays ~1s of font parsing + layout engine init, which would
	// otherwise land on a link unfurler's request and can exceed its timeout
	// (Slack gives up and shows no preview). Rendering the generic card now
	// also leaves it cached for shares without a renderable prompt.
	getShareThumbnailPng({
		prompt: "",
		isHuggingChat: config.isHuggingChat,
		appName: config.PUBLIC_APP_NAME,
	}).catch((err) => logger.warn({ err }, "Failed to warm up share thumbnail renderer"));

	adminTokenManager.displayToken();

	if (config.EXPOSE_API) {
		logger.warn(
			"The EXPOSE_API flag has been deprecated. The API is now required for chat-ui to work."
		);
	}
}
