import { derived } from "svelte/store";
import { base } from "$app/paths";
import { enabledServers, mcpServersLoaded, effectiveServerHeaders } from "./mcpServers";
import { error } from "./errors";

/** Mirror the last-used browser selection for personal Slack turns. No tokens are returned. */
export function syncMcpSelection(userId: string) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	let previous = "";
	let pending: Promise<void> = Promise.resolve();
	let reported = false;
	const unsubscribe = derived([enabledServers, mcpServersLoaded], (values) => values).subscribe(
		([servers, loaded]) => {
			if (!loaded) return;
			const body = JSON.stringify({
				userId,
				selectedMcpServerNames: servers.map((s) => s.name),
				selectedMcpServers: servers.map((s) => ({
					name: s.name,
					url: s.url,
					headers: effectiveServerHeaders(s),
					oauthConnectionId: s.oauth?.connectionId,
				})),
			});
			if (body === previous) return;
			previous = body;
			clearTimeout(timer);
			timer = setTimeout(() => {
				// Serialize writes so a slow older request cannot overwrite a newer selection.
				pending = pending.then(async () => {
					if (stopped) return;
					try {
						const response = await fetch(`${base}/api/mcp/selection`, {
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body,
						});
						if (!response.ok) throw new Error("Sync failed");
						reported = false;
					} catch {
						previous = "";
						if (!stopped && !reported) {
							error.set("Could not sync MCP servers for Slack. Reload HuggingChat to retry.");
							reported = true;
						}
					}
				});
			}, 300);
		}
	);
	return () => {
		stopped = true;
		clearTimeout(timer);
		unsubscribe();
	};
}
