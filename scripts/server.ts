import express from "express";
import { logger } from "$lib/server/logger.js";
import { handler } from "../build/handler.js";
import { APP_BASE } from "$env/static/private";

const app = express();
const metricsApp = express();
const METRICS_PORT = process.env.METRICS_PORT || "3001";

// Let SvelteKit handle everything else, including serving prerendered pages and static assets
app.use(handler);

app.listen(3000, () => {
	logger.info("Listening on port 3000");
});

// Set up metrics app to serve something when `/metrics` is accessed
metricsApp.get("/metrics", (req, res) => {
	res.set("Content-Type", "text/plain");
	fetch(`http://localhost:3000${APP_BASE}/metrics`)
		.then((response) => response.text())
		.then((text) => {
			res.send(text);
		})
		.catch(() => {
			res.send("Error fetching metrics.");
		});
});

metricsApp.listen(METRICS_PORT, () => {
	logger.info(`Metrics server listening on port ${METRICS_PORT}`);
});
