import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import type { McpServerConfig } from "./httpClient";
import { resetMcpToolsCache } from "./tools";

let cachedRaw: string | null = null;
let cachedServers: McpServerConfig[] = [];

function parseServers(raw: string): McpServerConfig[] {
    if (!raw) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .map((candidate) => {
                if (!candidate || typeof candidate !== "object") {
                    return undefined;
                }
                const name = (candidate as Record<string, unknown>).name;
                const url = (candidate as Record<string, unknown>).url;
                if (typeof name !== "string" || name.length === 0) {
                    return undefined;
                }
                if (typeof url !== "string" || url.length === 0) {
                    return undefined;
                }

                const headersRaw = (candidate as Record<string, unknown>).headers;
                let headers: Record<string, string> | undefined;
                if (headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw)) {
                    const entries = Object.entries(headersRaw).filter((entry): entry is [string, string] => {
                        return typeof entry[1] === "string";
                    });
                    headers = Object.fromEntries(entries);
                }

                return headers ? { name, url, headers } : { name, url };
            })
            .filter((server): server is McpServerConfig => Boolean(server));
    } catch {
        return [];
    }
}

function setServers(raw: string): void {
    const servers = parseServers(raw);
    cachedServers = servers;
    cachedRaw = raw;
    resetMcpToolsCache();
    logger.debug({ count: servers.length }, "[mcp] loaded server configuration");
}

export function loadMcpServersOnStartup(): McpServerConfig[] {
    const raw = config.MCP_SERVERS || "[]";
    setServers(raw);
    return cachedServers;
}

export function refreshMcpServersIfChanged(): void {
    const currentRaw = config.MCP_SERVERS || "[]";
    if (cachedRaw === null) {
        setServers(currentRaw);
        return;
    }

    if (currentRaw !== cachedRaw) {
        setServers(currentRaw);
    }
}

export function getMcpServers(): McpServerConfig[] {
    if (cachedRaw === null) {
        loadMcpServersOnStartup();
    }
    return cachedServers;
}

