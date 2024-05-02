import express from "express";
import { handler } from "../build/handler.js";

const app = express();
const metricsApp = express();
const METRICS_PORT = process.env.METRICS_PORT || "3001";

// Let SvelteKit handle everything else, including serving prerendered pages and static assets
app.use(handler);

app.listen(3000, "0.0.0.0", () => {
	console.log("Listening on port 3000");
});

// Set up metrics app to serve something when `/metrics` is accessed
metricsApp.get("/metrics", (req, res) => {
	res.set("Content-Type", "text/plain");
	fetch(`http://localhost:3000${process.env.APP_BASE ?? ""}/metrics`)
		.then((response) => response.text())
		.then((text) => {
			res.send(text);
		})
		.catch(() => {
			res.send("Error fetching metrics.");
		});
});

metricsApp.listen(METRICS_PORT, "0.0.0.0", () => {
	console.log(`Metrics server listening on port ${METRICS_PORT}`);
});
