// Minimal mock OpenAI-compatible API for screenshot testing.
// Returns a fake model so the app can boot without real API keys.

import http from "node:http";

const modelsResponse = JSON.stringify({
	object: "list",
	data: [
		{
			id: "mock-model/test-chat",
			object: "model",
			created: 1700000000,
			owned_by: "mock",
			description: "A mock model for screenshot testing",
			architecture: { input_modalities: ["text"] },
			providers: [],
		},
	],
});

const server = http.createServer((req, res) => {
	res.setHeader("Content-Type", "application/json");

	if (req.url === "/v1/models" || req.url === "/models") {
		res.writeHead(200);
		res.end(modelsResponse);
		return;
	}

	// Catch-all for chat completions (stream a minimal response)
	if (req.url?.includes("/chat/completions")) {
		res.writeHead(200);
		res.end(
			JSON.stringify({
				id: "mock",
				object: "chat.completion",
				choices: [{ index: 0, message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
			})
		);
		return;
	}

	res.writeHead(404);
	res.end(JSON.stringify({ error: "not found" }));
});

server.listen(18080, () => {
	console.log("Mock API server running on http://localhost:18080");
});
