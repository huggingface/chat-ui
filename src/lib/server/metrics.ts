import { collectDefaultMetrics, Registry, Counter} from "prom-client";
import express from "express";
import { logger } from "$lib/server/logger";
import { env } from "$env/dynamic/private";

export class MetricsServer {
	private static instance: MetricsServer;
	private conversationsTotal: Counter<string>;
	private messagesTotal: Counter<string>;

	private constructor() {
		const app = express();
		const port = env.METRICS_PORT || "5565";

		const server = app.listen(port, () => {
			logger.info(`Metrics server listening on port ${port}`);
		});

		const register = new Registry();
		collectDefaultMetrics({ register });

		this.conversationsTotal = new Counter({
			name: "conversations_total",
			help: "Total number of conversations",
			labelNames: ["model"],
			registers: [register]
		});

		this.messagesTotal = new Counter({
			name: "messages_total",
			help: "Total number of messages",
			labelNames: ["model"],
			registers: [register]
		});

		app.get("/metrics", (req, res) => {
			register.metrics().then((metrics) => {
				res.set("Content-Type", "text/plain");
				res.send(metrics);
			});
		});

		process.on("SIGINT", async () => {
			logger.info("Sigint received, disconnect metrics server ...");
			server.close(() => {
				logger.info("Server stopped ...");
			});
			process.exit();
		});
	}

	public static getInstance(): MetricsServer {
		if (!MetricsServer.instance) {
			MetricsServer.instance = new MetricsServer();
		}

		return MetricsServer.instance;
	}

	public incrementConversationsTotal(model: string) {
		this.conversationsTotal.labels(model).inc();
	}

	public incrementMessagesTotal(model: string) {
		this.messagesTotal.labels(model).inc();
	}

}
