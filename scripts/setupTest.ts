import { vi, afterAll } from "vitest";
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongoServer: MongoMemoryServer;
// Load the .env file
const envPath = resolve(__dirname, "../.env");
dotenv.config({ path: envPath });

// Read the .env file content
const envContent = fs.readFileSync(envPath, "utf-8");

// Parse the .env content
const envVars = dotenv.parse(envContent);

// Separate public and private variables
const publicEnv = {};
const privateEnv = {};

for (const [key, value] of Object.entries(envVars)) {
	if (key.startsWith("PUBLIC_")) {
		publicEnv[key] = value;
	} else {
		privateEnv[key] = value;
	}
}

vi.mock("$env/dynamic/public", () => ({
	env: publicEnv,
}));

vi.mock("$env/dynamic/private", async () => {
	mongoServer = await MongoMemoryServer.create();

	return {
		env: {
			...privateEnv,
			MONGODB_URL: mongoServer.getUri(),
		},
	};
});

afterAll(async () => {
	if (mongoServer) {
		await mongoServer.stop();
	}
});
