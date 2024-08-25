import { vi } from "vitest";
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";

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

vi.mock("$env/dynamic/private", () => ({
	env: {
		...privateEnv,
		MONGODB_URL: "mongodb://127.0.0.1:27017/",
	},
}));
