import { collectDefaultMetrics, Counter, Registry, Summary } from "prom-client";
import { logger } from "$lib/server/logger";
import { config } from "$lib/server/config";
import { createServer, type Server as HttpServer } from "http";
import { onExit } from "./exitHandler";

type ModelLabel = "model";

interface Metrics {
	model: {
		conversationsTotal: Counter<ModelLabel>;
		messagesTotal: Counter<ModelLabel>;
		tokenCountTotal: Counter<ModelLabel>;
		timePerOutputToken: Summary<ModelLabel>;
		timeToFirstToken: Summary<ModelLabel>;
		latency: Summary<ModelLabel>;
	};
}

export class MetricsServer {
	private static instance: MetricsServer | undefined;
	private readonly enabled: boolean;
	private readonly register: Registry;
	private readonly metrics: Metrics;
	private httpServer: HttpServer | undefined;

	private constructor() {
		this.enabled = config.METRICS_ENABLED === "true";
		this.register = new Registry();

		if (this.enabled) {
			collectDefaultMetrics({ register: this.register });
		}

		this.metrics = this.createMetrics();

		if (this.enabled) {
			this.startStandaloneServer();
		}
	}

	public static getInstance(): MetricsServer {
		if (!MetricsServer.instance) {
			MetricsServer.instance = new MetricsServer();
		}
		return MetricsServer.instance;
	}

	public static getMetrics(): Metrics {
		return MetricsServer.getInstance().metrics;
	}

	public static isEnabled(): boolean {
		return config.METRICS_ENABLED === "true";
	}

	public async render(): Promise<string> {
		if (!this.enabled) {
			return "";
		}

		return this.register.metrics();
	}

	private createMetrics(): Metrics {
		const labelNames: ModelLabel[] = ["model"];

		const noopRegistry = new Registry();

		const registry = this.enabled ? this.register : noopRegistry;

		return {
			model: {
				conversationsTotal: new Counter<ModelLabel>({
					name: "model_conversations_total",
					help: "Total number of conversations",
					labelNames,
					registers: [registry],
				}),
				messagesTotal: new Counter<ModelLabel>({
					name: "model_messages_total",
					help: "Total number of messages",
					labelNames,
					registers: [registry],
				}),
				tokenCountTotal: new Counter<ModelLabel>({
					name: "model_token_count_total",
					help: "Total number of tokens emitted by the model",
					labelNames,
					registers: [registry],
				}),
				timePerOutputToken: new Summary<ModelLabel>({
					name: "model_time_per_output_token_ms",
					help: "Per-token latency in milliseconds",
					labelNames,
					registers: [registry],
					maxAgeSeconds: 5 * 60,
					ageBuckets: 5,
				}),
				timeToFirstToken: new Summary<ModelLabel>({
					name: "model_time_to_first_token_ms",
					help: "Time to first token in milliseconds",
					labelNames,
					registers: [registry],
					maxAgeSeconds: 5 * 60,
					ageBuckets: 5,
				}),
				latency: new Summary<ModelLabel>({
					name: "model_latency_ms",
					help: "Total time to complete a response in milliseconds",
					labelNames,
					registers: [registry],
					maxAgeSeconds: 5 * 60,
					ageBuckets: 5,
				}),
			},
		};
	}

	private startStandaloneServer() {
		const port = Number(config.METRICS_PORT || "5565");

		if (!Number.isInteger(port) || port < 0 || port > 65535) {
			logger.warn(`Invalid METRICS_PORT value: ${config.METRICS_PORT}`);
			return;
		}

		this.httpServer = createServer(async (req, res) => {
			if (req.method !== "GET") {
				res.statusCode = 405;
				res.end("Method Not Allowed");
				return;
			}

			try {
				const payload = await this.render();
				res.setHeader("Content-Type", "text/plain; version=0.0.4");
				res.end(payload);
			} catch (error) {
				logger.error(error, "Failed to render metrics");
				res.statusCode = 500;
				res.end("Failed to render metrics");
			}
		});

		this.httpServer.listen(port, () => {
			logger.info(`Metrics server listening on port ${port}`);
		});

		onExit(async () => {
			if (!this.httpServer) return;
			logger.info("Shutting down metrics server...");
			await new Promise<void>((resolve, reject) => {
				this.httpServer?.close((err) => {
					if (err) {
						reject(err);
						return;
					}
					resolve();
				});
			}).catch((error) => logger.error(error, "Failed to close metrics server"));
			this.httpServer = undefined;
		});
	}
}
